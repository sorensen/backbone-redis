//    backbone-redis
//    (c) 2011 Beau Sorensen
//    backbone-redis may be freely distributed under the MIT license.
//    For all details and documentation:
//    https://github.com/sorensen/backbone-redis

// Redis client references
var pub,
    sub,
    db;

// Default socket event listener
var listener = 'backbone';

// Socket.io connection reference
var conn;

// Error and debug settings
var error,
    debug;

// Simple models and schemas
var models,
    schemas,
    hookable = [
        'create', 'read', 'update', 'delete',
        'publish', 'subscribe', 'unsubscribe'
    ];

// Require Underscore, if we're on the server, and it's not already present.
var _ = this._;
if (!_ && (typeof require !== 'undefined')) _ = require('underscore')._;

// Server side dependencies
if (typeof exports !== 'undefined'){
    var hooks = require('hooks');
}

module.exports = {

    // Configuration and setup
    //------------------------

    //###config
    config : function(opt, next) {
        conn = opt.io;
        db   = opt.db;
        pub  = opt.publish;
        sub  = opt.subscribe;

        opt.listener && (listener = opt.listener);

        opt.debug && (debug = opt.debug);
        opt.error && (debug = opt.error);

        this._configSocket();
        this._configRedis();
        next && next();
        return this;
    },

    model : function(name, obj){
        if (arguments.length == 1)
            return models[name];
        models[name] = obj;

        var self = this;

        // Add hooks' methods: `hook`, `pre`, and `post`
        for (var k in hooks) {
            models[name][k] = hooks[k];
        }
        for (var h in hookable) {
            models[name].hook(h, self[h]);
        }
        return this;
    },

    //###_configSocket
    // Set the incomming socket messages handler
    _configSocket = function() {
        var self = this;
        conn.sockets.on('connection', function (socket) {
            socket.on(listener, function (packet, fn) {
                self.process(socket, packet, fn);
            });
        });
    },

    process : function(socket, packet, fn) {
        var model   = packet.model,
            options = packet.options;

        if (!model || !model.type || !options || !options.method) {
            return (this.error('params', packet));
        }

        if (!options.method in hookable) {
            return (this.error('method', packet));
        }

        // Check for predefined model/schema
        if (models[model.type] && options.method in hookable) {
            models[model.type][options.method](socket, packet, fn);
            return;
        }
        this[options.method](socket, packet, fn);
    },

    //###_configRedis
    // Redis publish subscribe event handling
    _configRedis = function() {
        var self = this;

        // Redis published message, push new data to each
        // client connected with the givin channel
        sub.on('message', function(channel, packet) {
            packet = JSON.parse(packet);
            packet.options || (packet.options = {})
            packet.options.channel = channel;
            self._pushed(packet);
        });

        // Redis subscribe message, alert each client that
        // someone has joined the channel ( optional )
        sub.on('subscribe', function(channel, count) {
            conn.sockets.in(channel).emit('subscribed');
        });

        // Redis unsubscribe message, alert each client that
        // someone has left the channel ( optional )
        sub.on('unsubscribe', function(channel, count) {
            conn.sockets.in(channel).emit('unsubscribed');
        });
    },

    // Error and debug handlers
    //-------------------------

    //###error
    // Simple error helper messages
    error : function(err, packet) {
        if (!error) return;
        console.error('Error!', err);
        console.trace();
    },

    //###debug
    // Simple debug helper messages
    debug : function(msg, packet) {
        if (!debug) return;
        packet.options || (packet.options = {});
        if (msg in debug) console.debug(debug[msg]);
        else console.debug('Method: ' + packet.options.method, msg);
        console.trace();
    },

    // Pubsub routines
    //----------------

    //###subscribe
    // Channel subscription, add the client to the internal
    // subscription object, creating a container for the channel
    // if one does not exist, then subscribe to the Redis client
    subscribe : function(socket, packet, next) {
        var chan = packet.options.channel;
        socket.join(chan)
        sub.subscribe(chan);
        next && next(true);
    },

    //###unsubscribe
    // Unsubscribe from model changes via channel
    unsubscribe : function(socket, packet, next) {
        var chan = packet.options.channel;
        socket.leave(chan)
        sub.unsubscribe(chan);
        next && next(true);
    },

    //###publish
    // Publish to redis if a connection has been supplied,
    // otherwise send through to clients on this thread
    publish : function(socket, packet, next) {
        var chan = packet.options.channel;
        pub.publish(chan, JSON.stringify(packet));
        next && next(true);
    },

    //###pushed
    // Push a message to application clients based on channels, used
    // as the delivery method for redis published events, but can be
    // used by itself on a single thread basis
    _pushed : function(packet, next) {
        var chan = packet.options.channel;
        conn.sockets.in(chan).json.emit(listener, packet);
        next && next(true);
    },

    // CRUD Routines
    //--------------

    //###create
    // Create a new model with the givin data, publishing the
    // event to the pub/sub middleware, builds upon Backbone
    // options, if the option 'silent' is true, the event will
    // not be published, alternatively, an option 'temporary' may
    // be passed to publish the event without any persistance
    create : function(socket, packet, next) {
        var self    = this,
            model   = packet.model,
            options = packet.options,
            type    = model.type,
            chan    = options.channel;

        packet.options.method = 'created';

        // Generate the next redis id by model type to allow set transfers
        db.incr('next.' + type + '.id', function(err, rid) {
            if (err) return (self.error(err, packet));

            var  id   = model.id = rid,
                 data = JSON.stringify(model);

            db.set(id, data, function(err, isset) {
                if (err) return (self.error(packet, err));
                if (!isset) return (self.debug('set', packet));

                db.sadd(type, id,  function(err, added) {
                    if (err) return (self.error(err, packet));
                    if (!added) return (self.debug('sadd', packet));
                });
                options.silent || self.publish(packet);
                next && next(true);
            });
        });
    },

    //###read
    // Retrieve either a single model or collection of models
    // from the database, can optionally pass in sorting or
    // fields parameters, as well as a direct query statement
    // that can be executed directly against MongoDB
    read : function(socket, packet, next) {
        var model   = packet.model,
            options = packet.options,
            type    = model.type,
            chan    = options.channel;

        // Check to see if a specific model was requested based on 'id',
        // otherwise search the collection with the given parameters
        if (model.id) {
            db.get(model.id, function(err, doc) {
                if (err) return (self.error(err, packet));
                if (!doc) return (self.debug('get', packet));

                // Set the data and write to client
                packet.model = doc;
                socket.json.emit(listener, packet);
            });
            next && next(true);
            return;
        }
        db.smembers(type, function(err, list) {
            if (err) return (self.error(err, packet));
            if (!list) return (self.debug('smembers', packet));

            db.mget(list, function(err, result) {
                if (err) return (self.error(err, packet));
                if (!result) return (self.debug('mget', packet));

                // Send client the model data
                packet.model = _.map(result, function(record) {
                    return JSON.parse(record);
                });
                socket.json.emit(listener, packet);
                next && next(true);
            });
        });
    },

    //###update
    // Retrieve and update the attributes of a given model based on
    // the query parameters, delegate to the pub/sub middleware if a
    // change has been made, if a 'temporary' option has been provided,
    // the change can be published without persisting to the database
    update : function(socket, packet, next) {
        packet.options.method = 'updated';

        var self    = this,
            model   = packet.model,
            options = packet.options,
            type    = model.type,
            chan    = options.channel;
            id      = model.id,
            data    = JSON.stringify(model);

        if (!id) {
            console.log('update no id:');
            return;
        }
        db.get(id, function(err, exists) {
            if (err) return (self.error(err, packet));
            if (!exists) return (self.debug('get', packet));

            db.set(id, data, function(err, isset) {
                if (err) return (self.error(err, packet));
                if (!isset) return (self.debug('set', packet));

                options.silent || self.publish(packet);
                next && next(true);
            });
        });
    },

    //###destroy
    // Remove the specified model from the database, only one model may be
    // removed at a time, passing a 'temporary' option will publish the change
    // without persisting to the database
    delete : function(socket, packet, next) {
        packet.options.method = 'destroyed';

        var self    = this,
            model   = packet.model,
            options = packet.options,
            id      = model.id,
            type    = model.type,
            chan    = options.channel;

        db.sismember(type, id, function(err, member) {
            if (err) return (self.error(err, packet));
            if (member) {
                // Remove model from collection set
                db.srem(type, id, function(err, removed) {
                    if (err) return (self.error(err, packet));
                    if (!removed) return (self.debug('srem', packet));
                });
            }
            db.del(id, function(err, destroyed) {
                if (err) return (self.error(err, packet));
                if (!destroyed) return (self.debug('del', packet));

                options.silent || self.publish(packet);
                next && next(true);
            });
        });
    }
};
