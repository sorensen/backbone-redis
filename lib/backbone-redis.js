//    backbone-redis
//    (c) 2011 Beau Sorensen
//    backbone-redis may be freely distributed under the MIT license.
//    For all details and documentation:
//    https://github.com/sorensen/backbone-redis

// Redis client references
var pub,
    sub,
    db;

// Local storage container
var Store = {};

// Default socket event listener
var listener = 'message';

// Socket.io connection reference
var conn;

// Error and debug settings
var showError = false,
    showDebug = false;

// Configuration setting for pubsub mode, if set to false, the package
// will send all results directly to the calling user
var pubsubMode = true;
    
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
    var Backbone = require('backbone'),
        hooks    = require('hooks');
}

// Error and debug handlers
//-------------------------

//###errorMessage
// Simple error helper messages
function errorMessage(err, model, options) {
    options.error && options.error(err);
    if (!showError) return;
    console.error('Error!', err);
    console.trace();
    return this;
};

//###debugMessage
// Simple debug helper messages
function debugMessage(msg, model, options) {
    if (!showDebug) return;
    console.log('Debug: Method: ' + options.method + 'Msg: ', msg);
    return this;
}

_.mixin({
    // ###getUrl
    // Helper function to get a URL from a Model or Collection as a property
    // or as a function.
    getUrl : function(object) {
        if (!(object && object.url)) return null;
        return _.isFunction(object.url) ? object.url() : object.url;
    },

    //###sync
    // Set the model or collection's sync method to communicate through DNode
    sync : function(method, model, options) {
        options.type    || (options.type = model.type || model.collection.type);
        options.channel || (options.channel = (model.collection) ? _.getUrl(model.collection) : _.getUrl(model));
        options.method  || (options.method = method);
        module.exports.process(false, model.toJSON(), options, function(result){
            options.success && options.success(result);
        });
    }
});

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
            socket.on(listener, function (model, options, fn) {
                self.process(socket, model, options, fn);
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
            model = (packet.model || {});
            options = (packet.options || {});
            options.channel = channel;
            self._pushed(model, options);
        });

        // Redis subscribe message, alert each client that
        // someone has joined the channel ( optional )
        sub.on('subscribe', function(channel, count) {
            conn && conn.sockets.in(channel).emit(listener, false, {
                channel : channel,
                count   : count
            });
        });

        // Redis unsubscribe message, alert each client that
        // someone has left the channel ( optional )
        sub.on('unsubscribe', function(channel, count) {
            conn && conn.sockets.in(channel).emit(listener, false, {
                channel : channel,
                count   : count
            });
        });
        
        return this;
    },
    
    //###filter
    //TODO: implement a filtering function...
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
    // Process incomming messages, delegating them to the correct method,
    // if there is a defined schema for the given `type`, apply it to that 
    // schema directly for `hook` interaction. If we have a `subscribe` or
    // `unsubscribe` event, send the current socket connection
    process : function(socket, model, options, fn) {
        var method = options.method,
            type   = options.type;
        console.log('process', arguments);
        if (!options || !method) return (errorMessage('params', model, options));
        if (!method in hookable) return (errorMessage('method', model, options));
        
        // Check for predefined model/schema
        if (type && this.model(type)) {
            if (!!~method.indexOf('subscribe')) {
                return this.model(type)[method](socket, options, fn);
            }
            return this.model(type)[method](model, options, fn);
        }
        if (!!~method.indexOf('subscribe')) {
            return this[opt.method](socket, options, fn);
        }
        return this[opt.method](model, options, fn);
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
    subscribe : function(socket, options, cb) {
        var chan = options.channel;
        socket && socket.join(chan)
        sub && sub.subscribe(chan);
        cb && cb(options);
        return this;
    },

    //###unsubscribe
    // Unsubscribe from model changes via channel
    unsubscribe : function(socket, options, cb) {
        var chan = options.channel;
        socket && socket.leave(chan)
        sub && sub.unsubscribe(chan);
        cb && cb(model, options);
        return this;
    },

    //###publish
    // Publish to redis if a connection has been supplied,
    // otherwise send through to clients on this thread
    publish : function(model, options, cb) {
        var chan = options.channel;
        if (pub) pub.publish(chan, JSON.stringify({
                model   : model,
                options : options,
            }));
        else return this._pushed(model, options, cb);
        cb && cb(model, options);
        return this;
    },

    //###pushed
    // Push a message to application clients based on channels, used
    // as the delivery method for redis published events, but can be
    // used by itself on a single thread basis
    _pushed : function(model, options, cb) {
        var chan = options.channel;
        conn && conn.sockets.in(chan).json.emit(listener, model, options);
        cb && cb(model, options);
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
    create : function(doc, opt, cb) {
        opt.method = 'created';
        var self = this,
            type = opt.type,
            chan = opt.channel;
        
        if (!type) return (errorMessage('type', doc, opt));

        console.log('create', doc, opt, cb);

        // Generate the next redis id by model type to allow set transfers
        db.incr('next.' + type + '.id', function(err, rid) {
            if (err) return (errorMessage(err, doc, opt));

            doc.id = rid;
            data = JSON.stringify(doc);

            db.set(rid, data, function(err, isset) {
                if (err) return (errorMessage(doc, opt, err));
                if (!isset) return (debugMessage('set', doc, opt));

                db.sadd(type, rid,  function(err, added) {
                    if (err) return (errorMessage(err, doc, opt));
                    if (!added) return (debugMessage('sadd', doc, opt));
                });
                if (!opt.silent) return self.publish(doc, opt, cb);
                cb && cb(doc, opt);
                return self;
            });
        });
    },

    //###read
    // Retrieve either a single model or collection of models
    read : function(doc, opt, cb) {
        var type = opt.type,
            chan = opt.channel,
            self = this;

        // Check to see if a specific model was requested based on 'id',
        // otherwise search the collection with the given parameters
        if (doc.id) {
            db.get(doc.id, function(err, result) {
                if (err) return (errorMessage(err, doc, opt));
                if (!result) return (debugMessage('get', doc, opt));
                cb && cb(result, opt);
                return self;
            });
        }
        db.smembers(type, function(err, list) {
            if (err) return (errorMessage(err, doc, opt));
            if (!list || list.length < 1) return (debugMessage('smembers', doc, opt));

            db.mget(list, function(err, result) {
                if (err) return (errorMessage(err, doc, opt));
                if (!result) return (debugMessage('mget', doc, opt));

                // Send client the model data
                var parsed = _.map(result, function(record) {
                    return JSON.parse(record);
                });
                cb && cb(parsed, opt);
                return self;
            });
        });
    },

    //###update
    // Retrieve and update the attributes of a given model based on
    // the query parameters, delegate to the pub/sub middleware if a
    // change has been made, if a 'temporary' option has been provided,
    // the change can be published without persisting to the database
    update : function(doc, opt, cb) {
        opt.method = 'updated';
        var self = this,
            type = opt.type,
            chan = opt.channel;
            id   = doc.id,
            data = JSON.stringify(doc);

        if (!id) return (errorMessage('no id', doc, opt));

        db.get(id, function(err, exists) {
            if (err) return (errorMessage(err, doc, opt));
            if (!exists) return (debugMessage('get', doc, opt));

            db.set(id, data, function(err, isset) {
                if (err) return (errorMessage(err, doc, opt));
                if (!isset) return (debugMessage('set', doc, opt));
                if (!opt.silent) return self.publish(doc, opt, cb);
                cb && cb(doc, opt);
                return self;
            });
        });
    },

    //###destroy
    // Remove the specified model from the database, only one model may be
    // removed at a time, passing a 'temporary' option will publish the change
    // without persisting to the database
    delete : function(doc, opt, cb) {
        opt.method = 'deleted';
        var self = this,
            id   = doc.id,
            type = opt.type,
            chan = opt.channel;

        db.sismember(type, id, function(err, member) {
            if (err) return (errorMessage(err, doc, opt));
            if (member) {
                // Remove model from collection set
                db.srem(type, id, function(err, removed) {
                    if (err) return (errorMessage(err, doc, opt));
                    if (!removed) return (debugMessage('srem', doc, opt));
                });
            }
            db.del(id, function(err, destroyed) {
                if (err) return (errorMessage(err, doc, opt));
                if (!destroyed) return (debugMessage('del', doc, opt));
                if (!opt.silent) return self.publish(doc, opt, cb);
                cb && cb(doc, opt);
                return self;
            });
        });
    }
};

_.extend(Backbone.Model.prototype, {

    //###publish
    // Publish model data to the server for processing, this serves as
    // the main entry point for client to server communications.  If no
    // method is provided, it defaults to an 'update', which is the least
    // conflicting method when returned to the client for processing
    publish : function(options, next) {
        var model = this;
        options         || (options = {});
        options.channel || (options.channel = (model.collection) ? _.getUrl(model.collection) : _.getUrl(model));
        module.exports.publish(model.toJSON(), options, function(response){
            if (!options.silent) model.trigger('publish', model, options);
            next && next(response);
        });
        return this;
    }
});

var common = {
    
    //###subscribe
    // Subscribe to the 'Server' for model changes, if 'override' is set to true
    // in the options, this model will replace any other models in the local
    // 'Store' which holds the reference for future updates. Uses Backbone 'url'
    // for subscriptions, relabeled to 'channel' for clarity
    subscribe : function(options, next) {
        var model = this;
        options         || (options = {});
        options.type    || (options.type = model.type || model.collection.type);
        options.channel || (options.channel = (model.collection) ? _.getUrl(model.collection) : _.getUrl(model));
        options.method = 'subscribe';

        // Add the model to a local object container so that other methods
        // called from the 'Server' have access to it
        if (!Store[options.channel] || options.override) {
            Store[options.channel] = model;
            module.exports.process(false, false, options, function(resp){
                options.silent || model.trigger('subscribe', model, resp);
                next && next(resp);
            })
        } else {
            options.silent || model.trigger('subscribe', model, options);
            next && next(response);
        }
        return this;
    },

    //###unsubscribe
    // Stop listening for published model data, removing the reference in the local
    // subscription 'Store', will trigger an unsubscribe event unless 'silent'
    // is passed in the options
    unsubscribe : function(options, next) {
        var model = this;
        options         || (options = {});
        options.type    || (options.type = model.type || model.collection.type);
        options.channel || (options.channel = (model.collection) ? _.getUrl(model.collection) : _.getUrl(model));
        options.method = 'unsubscribe';

        module.exports.process(false, false, options, function(resp) {
            if (!options.silent) model.trigger('unsubscribe', model, resp);
            next && next(resp);
        });

        // The object must be deleted, or a new subscription with the same
        // channel name will not be correctly 'synced', unless a 'override'
        // option is sent upon subscription
        delete Store[options.channel];
        return this;
    }
}
// Extend both model and collection with the pub/sub mechanics
_.extend(Backbone.Model.prototype, common);
_.extend(Backbone.Collection.prototype, common);

