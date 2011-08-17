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
var listener = 'message';

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

//Require Backbone, if we're on the server, and it's not already present.
var Backbone = this.Backbone;
if (!Backbone && (typeof require !== 'undefined')) Backbone = require('Backbone');

_.extend(Backbone.Model.prototype, {
    // used to generate channel name from type
    channel : function() {
        var type = this.type || (this.collection ? this.collection.type : null);
        return this.type + (this.id ? ':' + this.id : '');
    }
});
_.extend(Backbone.Collection.prototype, {
    channel : function() {
        return this.type || (this.model && this.model.type ? this.model.type : null);
    }
});

// Server side dependencies
if (typeof exports !== 'undefined') {
    var hooks = require('hooks');
}

function Message(opt) {
    this.model   = opt.model;
    this.options = opt.options;
    this.options.type && (this.type = this.options.type);
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
        var model   = packet.model,
            options = packet.options,
            type    = options.type,
            method  = options.method;

        if (!(method == 'subscribe' || method == 'unsubscribe') && (!model || !type || !options || !options.method)) {
            return (this.error('params', packet));
        }

        if (!method in hookable) {
            return (this.error('method', packet));
        }

        // Check for predefined model/schema
        if (type && models && models[type] && options.method in hookable) {
            models[type][options.method](socket, packet, fn);
            return;
        }
        this[options.method](socket, packet, fn);
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
        var chan = packet.options.channel,
            type = packet.options.type;
        var str = JSON.stringify(packet);
        if (pub) {
            pub.publish(chan, str);
            if (chan !== type) {
                // also publish to the collection channel
                pub.publish(type, str);
            }
        }
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
        var self    = this,
            model   = packet.model,
            options = packet.options,
            type    = options.type,
            chan    = options.channel;

        packet.options.method = 'created';

        // Generate the next redis id by model type to allow set transfers
        db.incr('next.' + type + '.id', function(err, rid) {
            if (err) return (errorMessage(err, packet));

            var  id   = model.id = rid,
                 data = JSON.stringify(model);

            db.set(id, data, function(err, isset) {
                if (err) return (errorMessage(packet, err));
                if (!isset) return (debugMessage('set', packet));

                db.sadd(type, id,  function(err, added) {
                    if (err) return (errorMessage(err, packet));
                    if (!added) return (debugMessage('sadd', packet));
                });
                options.silent || self.publish(socket, packet, cb);
                cb && cb(true);
            });
        });
    },

    //###read
    // Retrieve either a single model or collection of models
    read : function(socket, packet, cb) {
        var self    = this,
            model   = packet.model,
            options = packet.options,
            type    = options.type,
            chan    = options.channel

        // Check to see if a specific model was requested based on 'id',
        // otherwise search the collection with the given parameters
        if (model.id) {
            db.get(model.id, function(err, doc) {
                if (err) return (errorMessage(err, packet));
                if (!doc) return (debugMessage('get', packet));

                // Set the data and write to client
                packet.model = JSON.parse(doc);
                socket.json.emit(listener, packet);
            });
            cb && cb(true);
            return;
        }
        db.smembers(type, function(err, list) {
            if (err) return (errorMessage(err, packet));
            if (!list) return (debugMessage('smembers', packet));

            if (list.length === 0) {
                packet.model = [];
                socket.json.emit(listener, packet);
                cb && cb(true); 
            }
            db.mget(list, function(err, result) {
                if (err) return (errorMessage(err, packet));
                if (!result) return (debugMessage('mget', packet));

                // Send client the model data
                packet.model = _.map(result, function(record) {
                    return JSON.parse(record);
                });
                socket.json.emit(listener, packet);
                cb && cb(true);
            });
        });
    },

    update : function(socket, packet, cb) {
        packet.options.method = 'updated';

        var self    = this,
            model   = packet.model,
            options = packet.options,
            type    = options.type,
            chan    = options.channel;
            id      = model.id,
            data    = JSON.stringify(model);

        if (!id) {
            console.log('update no id:');
            return;
        }
        db.get(id, function(err, exists) {
            if (err) return (errorMessage(err, packet));
            if (!exists) return (debugMessage('get', packet));

            db.set(id, data, function(err, isset) {
                if (err) return (errorMessage(err, packet));
                if (!isset) return (debugMessage('set', packet));

                options.silent || self.publish(socket, packet, cb);
                cb && cb(true);
            });
        });
    },

    //###destroy
    // Remove the specified model from the database, only one model may be
    // removed at a time, passing a 'temporary' option will publish the change
    // without persisting to the database
    delete : function(socket, packet, cb) {
        packet.options.method = 'destroyed';

        var self    = this,
            model   = packet.model,
            options = packet.options,
            id      = model.id,
            type    = options.type,
            chan    = options.channel;

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

                options.silent || self.publish(socket, packet, cb);
                cb && cb(true);
            });
        });
    }
};
