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
var showError = false,
    showDebug = false;
    
// Safe mode setting, turn on to allow undeclared
// model types to be persisted
var safeMode = false;

// Simple models and schemas
var models   = {},
    schemas  = {},
    hookable = [
        'create', 'read', 'update', 'delete',
        'publish', 'subscribe', 'unsubscribe'
    ];

// Require Underscore, if we're on the server, and it's not already present.
var _ = this._;
if (!_ && (typeof require !== 'undefined')) _ = require('underscore')._;

// Server side dependencies
if (typeof exports !== 'undefined') {
    var hooks = require('hooks');
}

// Error and debug handlers
//-------------------------

//###errorMessage
// Simple error helper messages
function errorMessage(err, packet) {
    if (!showError) return;
    console.error('Error!', err);
    console.trace();
    return this;
};

//###debugMessage
// Simple debug helper messages
function debugMessage(msg, packet) {
    if (!showDebug) return;
    packet.options || (packet.options = {});
    console.log('Debug: Method: ' + packet.options.method + 'Msg: ', msg);
    return this;
}

module.exports = {

    // Configuration and setup
    //------------------------
    
    //###config
    config : function(opt, cb) {
        opt.io        && (conn      = opt.io);
        opt.database  && (db        = opt.database);
        opt.publish   && (pub       = opt.publish);
        opt.subscribe && (sub       = opt.subscribe);
        opt.listener  && (listener  = opt.listener);
        opt.showDebug && (showDebug = opt.showDebug);
        opt.showError && (showError = opt.showError);

        conn && this._configSocket();
        this._configRedis();
        
        
        cb && cb();
        return this;
    },

    //###_configSocket
    // Set the incomming socket messages handler
    _configSocket : function() {
        if (!conn) return this;
        var self = this;
        conn.sockets.on('connection', function (socket) {
            socket.on(listener, function (packet, fn) {
                self.process(socket, packet, fn);
            });
        });
        return this;
    },

    //###_configRedis
    // Redis publish subscribe event handling
    _configRedis : function() {
        if (!sub) return this;
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
            conn && conn.sockets.in(channel).emit('subscribed');
        });

        // Redis unsubscribe message, alert each client that
        // someone has left the channel ( optional )
        sub.on('unsubscribe', function(channel, count) {
            conn && conn.sockets.in(channel).emit('unsubscribed');
        });
        
        return this;
    },
    
    //###filter
    filter : function(type, data) {
        var filtered = {};
        for (attr in this.model(type)) {
            filtered[attr] = doc[attr]
                ? doc[attr]
                : schemas[type][attr];
        }
        return filtered;
    },

    //###process
    process : function(socket, packet, fn) {
        var doc   = packet.model,
            opt    = packet.options,
            method = opt.method,
            type   = opt.type;

        if (!doc || !opt || !method) {
            return (this.error('params', packet));
        }
        if (!method in hookable) {
            return (this.error('method', packet));
        }
        
        // Check for predefined model/schema
        if (type && this.model(type)) {
            return this.model(type)[method](socket, packet, fn);
        }
        return this[opt.method](socket, packet, fn);
    },

    //###schema
    // Get or set a model schema, add hooks' methods for
    // `hook`, `pre`, and `post`, as well as all hookable
    // methods for pubsub and crud routines.
    schema : function(obj) {
        var self = this;
        for (var k in hooks) obj[k] = hooks[k];
        _.each(hookable, function(h) {
            obj[h] = self[h];
            obj.hook(h, obj[h]);
        });
        return obj;
    },

    //###model
    // Get or set a model schema, add hooks' methods for
    // `hook`, `pre`, and `post`, as well as all hookable
    // methods for pubsub and crud routines.
    model : function(type, obj) {
        if (arguments.length == 1)
            return models[type];
        models[type] = obj;
        return this;
    },

    // Pubsub routines
    //----------------

    //###subscribe
    // Channel subscription, add the client to the internal
    // subscription object, creating a container for the channel
    // if one does not exist, then subscribe to the Redis client
    subscribe : function(socket, packet, cb) {
        var chan = packet.options.channel;
        socket && socket.join(chan)
        sub && sub.subscribe(chan);
        cb && cb(true);
        return this;
    },

    //###unsubscribe
    // Unsubscribe from model changes via channel
    unsubscribe : function(socket, packet, cb) {
        var chan = packet.options.channel;
        socket && socket.leave(chan)
        sub && sub.unsubscribe(chan);
        cb && cb(true);
        return this;
    },

    //###publish
    // Publish to redis if a connection has been supplied,
    // otherwise send through to clients on this thread
    publish : function(socket, packet, cb) {
        var chan = packet.options.channel;
        if (pub) pub.publish(chan, JSON.stringify(packet));
        else return this._pushed(packet, cb);
        cb && cb(true);
        return this;
    },

    //###pushed
    // Push a message to application clients based on channels, used
    // as the delivery method for redis published events, but can be
    // used by itself on a single thread basis
    _pushed : function(packet, cb) {
        var chan = packet.options.channel;
        conn && conn.sockets.in(chan).json.emit(listener, packet);
        cb && cb(true);
        return this;
    },

    // CRUD Routines
    //--------------

    //###create
    // Create a new model with the givin data, publishing the
    // event to the pub/sub middleware, builds upon Backbone
    // options, if the option 'silent' is true, the event will
    // not be published, alternatively, an option 'temporary' may
    // be passed to publish the event without any persistance
    create : function(socket, packet, cb) {
        packet.options.method = 'created';
        
        var self = this,
            doc  = packet.model,
            opt  = packet.options,
            type = opt.type,
            chan = opt.channel;

        // Generate the next redis id by model type to allow set transfers
        db.incr('next.' + type + '.id', function(err, rid) {
            if (err) return (errorMessage(err, packet));

            doc.id = rid;
            data = JSON.stringify(doc);

            db.set(rid, data, function(err, isset) {
                if (err) return (errorMessage(packet, err));
                if (!isset) return (debugMessage('set', packet));

                db.sadd(type, rid,  function(err, added) {
                    if (err) return (errorMessage(err, packet));
                    if (!added) return (debugMessage('sadd', packet));
                });
                if (!opt.silent) return self.publish(socket, packet, cb);
                cb && cb(true);
                return this;
            });
        });
    },

    //###read
    // Retrieve either a single model or collection of models
    read : function(socket, packet, cb) {
        var doc  = packet.model,
            opt  = packet.options,
            type = opt.type,
            chan = opt.channel,
            self = this;

        // Check to see if a specific model was requested based on 'id',
        // otherwise search the collection with the given parameters
        if (doc.id) {
            db.get(doc.id, function(err, result) {
                if (err) return (errorMessage(err, packet));
                if (!result) return (debugMessage('get', packet));

                // Set the data and write to client
                packet.model = result;
                socket.json.emit(listener, packet);
            });
            cb && cb(true);
            return this;
        }
        db.smembers(type, function(err, list) {
            if (err) return (errorMessage(err, packet));
            if (!list || list.length < 1) return (debugMessage('smembers', packet));

            db.mget(list, function(err, result) {
                if (err) return (errorMessage(err, packet));
                if (!result) return (debugMessage('mget', packet));

                // Send client the model data
                packet.model = _.map(result, function(record) {
                    return JSON.parse(record);
                });
                socket.json.emit(listener, packet);
                cb && cb(true);
                return this;
            });
        });
    },

    //###update
    // Retrieve and update the attributes of a given model based on
    // the query parameters, delegate to the pub/sub middleware if a
    // change has been made, if a 'temporary' option has been provided,
    // the change can be published without persisting to the database
    update : function(socket, packet, cb) {
        packet.options.method = 'updated';

        var self = this,
            doc  = packet.model,
            opt  = packet.options,
            type = opt.type,
            chan = opt.channel;
            id   = doc.id,
            doc  = JSON.stringify(doc);

        if (!id) return (this.error('no id', packet));

        db.get(id, function(err, exists) {
            if (err) return (errorMessage(err, packet));
            if (!exists) return (debugMessage('get', packet));

            db.set(id, doc, function(err, isset) {
                if (err) return (errorMessage(err, packet));
                if (!isset) return (debugMessage('set', packet));

                if (!opt.silent) return self.publish(socket, packet, cb);
                cb && cb(true);
                return this;
            });
        });
    },

    //###destroy
    // Remove the specified model from the database, only one model may be
    // removed at a time, passing a 'temporary' option will publish the change
    // without persisting to the database
    delete : function(socket, packet, cb) {
        packet.options.method = 'deleted';

        var self = this,
            doc  = packet.model,
            opt  = packet.options,
            id   = doc.id,
            type = opt.type,
            chan = opt.channel;

        db.sismember(type, id, function(err, member) {
            if (err) return (errorMessage(err, packet));
            if (member) {
                // Remove model from collection set
                db.srem(type, id, function(err, removed) {
                    if (err) return (errorMessage(err, packet));
                    if (!removed) return (debugMessage('srem', packet));
                });
            }
            db.del(id, function(err, destroyed) {
                if (err) return (errorMessage(err, packet));
                if (!destroyed) return (debugMessage('del', packet));

                if (!opt.silent) return self.publish(socket, packet, cb);
                cb && cb(true);
                return this;
            });
        });
    }
};
