//    backbone-redis
//    (c) 2011 Beau Sorensen
//    backbone-redis may be freely distributed under the MIT license.
//    For all details and documentation:
//    https://github.com/sorensen/backbone-redis

(function () {

    // Save a reference to the global object.
    var root = this;

    // The top-level namespace. All public classes and modules will
    // be attached to this.
    var core;

    // Remote server socket connection reference
    var socket;

    // Default socket event listener
    var listener = 'message';

    // Storage container for subscribed models, allowing the returning method
    // calls from the server know where and how to find the model in question
    var Store = root.Store || (root.Store = {});

    // Require Underscore, if we're on the server, and it's not already present.
    var _ = root._;
    if (!_ && (typeof require !== 'undefined')) _ = require('underscore')._;

    // Require Backbone, if we're on the server, and it's not already present.
    var Backbone = root.Backbone;
    if (!Backbone && (typeof require !== 'undefined')) Backbone = require('backbone');

    var modelRegistry = {}, callbacksRegistry = {};
    var useModelOnce = function (channel) {
        var model = modelRegistry[channel];
        if (!model) return;
        delete modelRegistry[channel];
        return model;
    }
    var useCallbacksOnce = function (channel) {
      var callbacks = callbacksRegistry[channel];
      if (!callbacks) return;
      delete callbacksRegistry[channel];
      return callbacks;
    }
    var registerOnce = function (model, options) {
        var channel = options.channel; 
        // use the entire options hash as key
        modelRegistry[channel] = model;
        callbacksRegistry[channel] = {
            success: options.success,
            error: options.error
        };
    }

    core = {

        // ###config
        config: function (options, next) {
            options.io && (socket = options.io);
            options.listener && (listener = options.listener);

            socket.on(listener, function (packet) {
                core.process(packet);
            });
            next && next();
        },

        // ###process
        process: function (packet) {
            var model = packet.model, options = packet.options;

            if (!options || !options.method) { return; }
            switch (options.method)
            {
                case 'published':
                    core.published(packet);
                    break;
                case 'subscribed':
                    core.subscribed(packet);
                    break;
                case 'unsubscribed':
                    core.unsubscribed(packet);
                    break;
                case 'created':
                    core.created(packet);
                    break;
                case 'read':
                    core.read(packet);
                    break;
                case 'updated':
                    core.updated(packet);
                    break;
                case 'destroyed':
                    core.destroyed(packet);
                    break;
            }
        },

        // Pubsub routines
        // ----------------

        // ###subscribed
        // Someone has subscribed to a channel
        // Note: This method is not required to run the
        // application, it may prove as a useful way to
        // update clients, and it may prove to be an added
        // security risk, when private channels are involved
        subscribed: function (packet) {
            var options = packet.options;
            options.finished && options.finished(packet);
        },

        // ###unsubscribed
        // Someone has unsubscribed from a channel, see the
        // note above, as it applies to this method as well
        unsubscribed: function (packet) {
            var options = packet.options;
            options.finished && options.finished(packet);
        },

        // ###published
        // Data has been published by another client, this serves
        // as the main entry point for server to client communication.
        // Events are delegated based on the original method passed,
        // and are sent to 'crud.dnode.js' for completion
        published: function (packet) {
            var options = packet.options;
            if (!options.method) { return; }
            switch (options.method)
            {
                case 'create':
                    core.created(packet);
                    break;
                case 'read':
                    core.read(packet);
                    break;
                case 'update':
                    core.updated(packet);
                    break;
                case 'delete':
                    core.destroyed(packet);
                    break;
            }
            ;
        },

        // CRUD routines
        // --------------

        // ###created
        // A model has been created on the server,
        // get the model or collection based on channel
        // name or channel to set or add the new data
        created: function (packet) {
            var data = packet.model, options = packet.options, model = Store[options.channel];

            // Model processing
            if (model instanceof Backbone.Model) {
                model.set(model.parse(data));
                // Collection processing
            } else if (model instanceof Backbone.Collection) {
                if (!model.get(data.id)) model.add(model.parse(data));
            }
            options.finished && options.finished(data);
        },

        // ###read
        // The server has responded with data from a
        // model or collection read event, set or add
        // the data to the model based on channel
        read: function (packet) {
            var data = packet.model, options = packet.options, channel = options.channel, model = Store[channel] || useModelOnce(channel), callbacks = callbacksRegistry[channel];

            // Model Processing
            if (model instanceof Backbone.Model) {
                model.set(model.parse(data));
                // Collection processing
            } else if (model instanceof Backbone.Collection) {
                if (_.isArray(data)) {
                    model.reset(model.parse(data));
                } else if (!model.get(data.id)) {
                    model.add(model.parse(data));
                }
            }
            var resp = model instanceof Backbone.Collection ? model.models : model;
            // we still have to do the success callback
            callbacks.success && callbacks.success(resp); 
            options.finished && options.finished(data);
        },

        // ###updated
        // A model has been updated with new data from the
        // server, set the appropriate model or collection
        updated: function (packet) {
            var data = packet.model, options = packet.options, model = Store[options.channel];

            // Collection processing
            if (model.get(data.id)) {
                model.get(data.id).set(model.parse(data));
                // Model processing
            } else {
                model.set(model.parse(data));
            }
            options.finished && options.finished(data);
        },

        // ###destroyed
        // A model has been destroyed
        destroyed: function (packet) {
            var data = packet.model, options = packet.options, model = Store[options.channel];

            Store[options.channel].remove(data) || delete Store[options.channel];
            options.finished && options.finished(data);
        }
    };

    // Extend default Backbone functionality
    _.extend(Backbone.Model.prototype, {

        // ###publish
        // Publish model data to the server for processing, this serves as
        // the main entry point for client to server communications. If no
        // method is provided, it defaults to an 'update', which is the least
        // conflicting method when returned to the client for processing
        publish: function (options, next) {
            if (!socket) return (options.error && options.error(503, model, options));
            var model = this;
            options || (options = {});
            options.channel || (options.channel = model.getChannel());
            options.method = 'publish';
            options.type = model.type;

            var packet = {
                model: model.toJSON(),
                options: options
            };
            socket.emit(listener, packet, function (response) {
                if (!options.silent) model.trigger('publish', model, options);
                next && next(response);
            });
            return this;
        },

        // used to generate channel name from type
        getChannel: function () {
            var type = this.type || (this.collection ? this.collection.type : null);
            return this.type + (this.id ? ':' + this.id : '');
        }
    });

    _.extend(Backbone.Collection.prototype, {
        getChannel: function () {
            return this.type || (this.model && this.model.type ? this.model.type : null);
        }
    });

    // Common extention object for both models and collections
    var common = {

        // ###connection
        // Setting a reference to the DNode/socket connection to allow direct
        // server communication without the need of a global object
        connection: socket,

        // ###subscribe
        // Subscribe to the 'Server' for model changes, if 'override' is set to
        // true
        // in the options, this model will replace any other models in the local
        // 'Store' which holds the reference for future updates. Uses Backbone
        // 'channel'
        // for subscriptions, relabeled to 'channel' for clarity
        subscribe: function (options, next) {
            if (!socket) return (options.error && options.error(503, model, options));
            var model = this;
            options || (options = {});
            options.channel || (options.channel = model.getChannel());
            options.method = 'subscribe';
            options.type = model.type;

            var packet = {
                model: model.toJSON(),
                options: options
            };

            // Add the model to a local object container so that other methods
            // called from the 'Server' have access to it
            if (!Store[options.channel] || options.override) {
                Store[options.channel] = model;
                socket.emit(listener, packet, function (response) {
                    if (!options.silent) model.trigger('subscribe', model, options);
                    next && next(response);
                });
            } else {
                if (!options.silent) model.trigger('subscribe', model, options);
                next && next(response);
            }
            return this;
        },

        // ###unsubscribe
        // Stop listening for published model data, removing the reference in
        // the local
        // subscription 'Store', will trigger an unsubscribe event unless
        // 'silent'
        // is passed in the options
        unsubscribe: function (options, next) {
            if (!socket) return (options.error && options.error(503, model, options));
            var model = this;
            options || (options = {});
            options.channel || (options.channel = model.getChannel());
            options.method = 'unsubscribe';

            var packet = {
                model: {},
                options: options
            }
            socket.emit(listener, packet, function (response) {
                if (!options.silent) model.trigger('unsubscribe', model, options);
                next && next(response);
            });

            // The object must be deleted, or a new subscription with the same
            // channel name will not be correctly 'synced', unless a 'override'
            // option is sent upon subscription
            delete Store[options.channel];
            return this;
        }
    };

    // Add to underscore utility functions to allow optional usage
    // This will allow other storage options easier to manage, such as
    // 'localStorage'. This must be set on the model and collection to
    // be used on directly. Defaults to 'Backbone.sync' otherwise.
    _.mixin({

        // ###sync
        // Set the model or collection's sync method to communicate through
        // DNode
        sync: function (method, model, options) {
            if (!socket) return (options.error && options.error(503, model, options));

            // Remove the Backbone id from the model as not to conflict with
            // Mongoose schemas, it will be re-assigned when the model returns
            // to the client side
            if (model.attributes && model.attributes._id) delete model.attributes.id;

            // Set the RPC options for model interaction
            options.type || (options.type = model.type || model.collection.type);
            options.channel || (options.channel = model.getChannel());
            options.method || (options.method = method);
            options.indexProps = model.indexProps || (model.model && model.model.prototype.indexProps ? model.model.prototype.indexProps : []);
            options.extKeys = model.extKeys || (model.model && model.model.prototype.extKeys ? model.model.prototype.extKeys : []);
            if (typeof model == Backbone.Collection && model.extKey) {
              options.extKey = model.extKey;
            }

            registerOnce(model, options);

            // Create the packet to send over the wire
            var packet = {
                model: model.toJSON(),
                options: options
            }
            if (method === 'read') {
                var lookupModel = {};
                packet.model.id && (lookupModel.id = packet.model.id);
                packet.model = lookupModel;
            }
            socket.emit(listener, packet);
        }
    });

    // Extend both model and collection with the pub/sub mechanics
    _.extend(Backbone.Model.prototype, common);
    _.extend(Backbone.Collection.prototype, common);

    // Exported for both CommonJS and the browser.
    if (typeof exports !== 'undefined') module.exports = core;
    else root.core = core;

}).call(this)
