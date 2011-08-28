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

// Require Backbone, if we're on the server, and it's not already present.
var Backbone = this.Backbone;
if (!Backbone && (typeof require !== 'undefined')) Backbone = require('backbone');

_.extend(Backbone.Model.prototype, {
  indexProps: {},
  getChannel : function() {
    var type = this.type || (this.collection ? this.collection.type : null);
    if (!type) throw new Error("No type found on model or related collection.");
    return this.type + ':' + this[this.idAttribute];
  },
  subscribe: function () {return this},
  unsubscribe: function () {return this}
});
_.extend(Backbone.Collection.prototype, {
  getChannel : function() {
    var type = this.type || (this.model && this.model.type ? this.model.type : null);
    if (!type) throw new Error("No type found on collection or related model.");
    // @TODO: use conditions for channel creation?
    return type;
  },
  unsubscribe: function () {return this},
  subscribe: function () {return this}
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
// -------------------------

// ###errorMessage
// Simple error helper messages
function errorMessage(err, packet) {
    if (!showError) return;
    console.error('Error!', err);
    console.trace();
    return this;
};

// ###debugMessage
// Simple debug helper messages
function debugMessage(msg, packet) {
    if (!showDebug) return;
    packet.options || (packet.options = {});
    console.log('Debug: Method: ' + packet.options.method + 'Msg: ', msg);
    return this;
}

var clientRegistry = {};
function useClientOnce (channel) {
  var use = clientRegistry[channel];
  if (!use) return;
  delete clientRegistry[channel];
  return use;
}
function registerClientOnce (channel) {
  clientRegistry[channel] = 1;
}

var Sync = module.exports = {

    // Configuration and setup
    // ------------------------
    
    // ###config
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

    // ###_configSocket
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

    // ###_configRedis
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
    
    _getSortKey: function (channel, sortBy) {
      return channel + '::' + sortBy + '::';
    },
    
    _getExtKey: function (channel, extKey, id) {
      return channel + '::' + extKey + ':' + id + '::';
    },

    filter: function (records, conditions) {
        if (!conditions) {
          return records;
        }
        if (!_.isArray(conditions)) {
          conditions = [conditions];
        }
        var single = false;
        if (!_.isArray(records)) {
          records = [records];
          single = true;
        }
        // validate conditions first
        _.each(conditions, function (condition, key){
          if (_.isNumber(key)) {
            // signature: {prop: 'foo', val: 'bar', op: '!='}
            var prop = condition.prop
              , val = _.condition.val
              , op = condition.op;
            // sanitize value
            conditions[key].val = sanitize(val).xss();
          } else {
            // signature: {foo: 'bar'} gets operator '=='
            var prop = key
              , val = condition
              , op = '==';
            // sanitize value
            conditions[key] = sanitize(val).xss();
          }
          // and check for property format and operator
          if(!(prop.test(/[a-zA-Z_][a-zA-Z0-9_]*/) &&
              op && op.test(/(==|===|!=|!==|>|<|>=|<=)/)))
          {
            throw new Error("Invalid condition: '" + prop + op + val + "'");
          }
          
        });
        // alrighty, lets filter!
        collection = _.select(records, function (record) {
          _.each(conditions, function (condition, key){
            var prop = condition.prop
              , val = condition.val
              , op = condition.op;
            // after all our checks we should now be safe to use eval
            if (eval("record[prop] " + op + " value;") === false) {
              return false;
            }
          }); 
          return true;
        });
        if (single) {
          return _.first(collection);
        }
        return collection;
    },
        
    // ###process
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

    // ###schema
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

    // ###model
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
    // ----------------

    // ###subscribe
    // Channel subscription, add the client to the internal
    // subscription object, creating a container for the channel
    // if one does not exist, then subscribe to the Redis client
    subscribe : function(socket, packet, cb) {
        var chan = packet.options.channel;
        socket && socket.join(chan);
        sub && sub.subscribe(chan);
        cb && cb(true);
        return this;
    },

    // ###unsubscribe
    // Unsubscribe from model changes via channel
    unsubscribe : function(socket, packet, cb) {
        var chan = packet.options.channel;
        socket && socket.leave(chan);
        sub && sub.unsubscribe(chan);
        cb && cb(true);
        return this;
    },

    // ###publish
    // Publish to redis if a connection has been supplied,
    // otherwise send through to clients on this thread
    publish : function(socket, packet, cb) {
        var chan = packet.options.channel,
            type = packet.options.type;
        var str = JSON.stringify(packet);
        if (pub) {
            // publish to redis
            pub.publish(chan, str);
            if (chan !== type) {
                // also publish to the collection channel
                pub.publish(type, str);
            }
        } else return this._pushed(packet, cb);
        cb && cb(true);
        return this;
    },

    // ###pushed
    // Push a message to application clients based on channels, used
    // as the delivery method for redis published events, but can be
    // used by itself on a single thread basis
    _pushed : function(packet, cb) {
        var chan = packet.options.channel,
            type = packet.options.type;
        if (conn) {
          conn.sockets.in(chan).json.emit(listener, packet);
          if (chan !== type) {
            // also publish to the collection channel
            conn.sockets.in(type).json.emit(listener, packet);
          }
        }
        cb && cb(true);
        return this;
    },

    _getTypeId: function (type, id) {
      return type + ':' + id;
    },
    
    // CRUD Routines
    // --------------

    // ###create
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
            channel = options.channel,
            index   = options.indexProps
            extKeys = options.extKeys;

        packet.options.method = 'created';

        // Generate the next redis id by model type to allow set transfers
        db.incr('next.' + type + '.id', function(err, rid) {
            if (err) {
              options.error && options.error(err);
              return (errorMessage(err, packet));
            }

            model.dateCreated = model.dateModified = new Date().getTime();
            var id   = model.id = rid,
                data = JSON.stringify(model);

            var multi = db.multi();
            // first set the object itself with the type id as key
            var typeId = Sync._getTypeId(type, id);
            multi.set(typeId, data);
            // then go over all our index props and set those too
            Sync._setIndexProps(model, type, index, multi);
            // we always want to store the date created index
            multi.set(Sync._getSortKey(type, 'dateModified') + id, model.dateModified)
            multi.set(Sync._getSortKey(type, 'dateCreated') + id, model.dateCreated)
            // then go over all our external keys and set those too
            Sync._setExtKeys(model, null, type, extKeys, multi);
            // and add to the set
            multi.sadd(type, typeId);
            // execute
            multi.exec(function(err, isset) {
              if (err) return (errorMessage(packet, err));
              if (!isset) return (debugMessage('set', packet));

              options.silent || self.publish(socket, packet);
              cb && cb(true);
            })
        });
    },
    
    _setIndexProps: function (model, type, index, multi) {
      _.each(index, function(prop) {
        // convert booleans to 1 or 0 for sorting
        var val = _.isBoolean(model[prop])  ? (model[prop] ? 1 : 0) : model[prop];
        var identifier = Sync._getSortKey(type, prop) + model.id;
        multi.set(identifier, val);
      });
    },
    
    _unsetIndexProps: function (model, type, index, multi) {
      _.each(index, function(prop) {
        var identifier = Sync._getSortKey(type, prop) + model.id;
        multi.del(identifier);
      });
    },
        
    /**
     * Set external keys:
     * - all keys if no oldModel provided
     * - if oldModel, only keys that have a different value compared to oldModel
     */
    _setExtKeys: function (model, oldModel, type, keys, multi) {
      var workingModel = oldModel || model;
      _.each(keys, function(key) {
        // skip if no work
        if (!model[key] && (!oldModel || !workingModel[key])) return;
        
        var val = model[key];
        if (!_.isArray(val)) {
          val = [val];
        }
        var oldVal = workingModel[key];
        if (typeof oldVal !== 'undefined' && !_.isArray(oldVal)) {
          oldVal = [oldVal];
        }

        // lets make an index for each item in the array
        // this enables us to find has many relations
        _.each(val, function(v){
          if (v && (!oldModel || _.indexOf(v, oldVal) === -1)) { // only set when necessary
            var identifier = Sync._getExtKey(type, key, v) + model.id;
            multi.set(identifier, v);
          }
        })
      });
    },
    
    /**
     * Unset external keys:
     * - all keys if no oldModel provided
     * - if oldModel, only keys from oldModel that are different from the new model
     */
    _unsetExtKeys: function (model, oldModel, type, keys, multi) {
      var workingModel = oldModel || model;
      _.each(keys, function(key) {
        // skip if no work
        if (!model[key] && (!oldModel || !workingModel[key])) return;

        var val = model[key];
        if (typeof val !== 'undefined' && !_.isArray(val)) {
          val = [val];
        }
        var oldVal = workingModel[key];
        if (typeof oldVal !== 'undefined' && !_.isArray(oldVal)) {
          oldVal = [oldVal];
        }
        _.each(oldVal, function(v){
          if (v && (!oldModel || _.indexOf(v, val) === -1)) { // only unset when necessary
            var identifier = Sync._getExtKey(type, key, v) + model.id;
            multi.del(identifier);
          }
        })
      });
    },

    // ###read
    // Retrieve either a single model or collection of models
    read: function (socket, packet) {
      var model = packet.model,
          options = packet.options,
          type = options.type,
          index = options.indexProps,
          extKey = options.extKey,
          channel = options.channel,
          sort = options.sort || {},
          limit = sort.limit;

      // Check to see if a specific model was requested based on 'id',
      // otherwise search the collection with the given parameters
      if (model.id) {
        var typeId = Sync._getTypeId(type, model.id);
        redisClient.get(typeId, function (err, record) {
          if (err) {
            errorMessage(err, packet);
          }
          if (!record) {
            debugMessage('get', packet);
            options.error && options.error(record);
          } else {
            record = JSON.parse(record);
            options.success && options.success(record);
          }
          if (socket) {
            packet.model = record;
            socket.json.emit(listener, packet);
          }
        });
        return;
      }
      var processRecords = function (err, records) {
        if (err || ! records) {
          err = err || 'no collection items found for list: ' + JSON.stringify(list);
          errorMessage(err, packet);
          options.error && options.error(err);
          if (socket) {
            packet.model = null;
            socket.json.emit(listener, packet);
          }
          return;
        }
        
        // create json objects from the strings
        var collection = _.map(records, function (record) {
          return JSON.parse(record);
        });
        
        // filter by conditions?
//        conditions && (collection = Sync.filter(collection, conditions));
        
        if (socket) {
          packet.model = collection;
          socket.json.emit(listener, packet);
        }
        options.success && options.success(collection);
      };
      var args = [channel, 'by'];
      if (extKey) {
        // get collection by extKey
        var prop, v;
        for (prop in extKey) {
          v = extKey[prop];
        }
        var key = Sync._getExtKey(type, prop, v) + '*';
        args = [key];
      } else {
        var key = sort.by ? Sync._getSortKey(type, sort.by) + '*' : 'nosort';
        args.push(key);
        // add limit?
        if (limit) {
          limit && (limit = limit.split('-'));
          var limitStart = limit[0] - 1 < 0 ? 0 : limit[0] - 1;
          args.push('limit', limitStart, limit[1]);
        }
        // add type hint for string prop?
        index && index[sort.by] && _.isString(index[sort.by]) && args.push('alpha');
        // add dir?
        sort.dir && args.push(sort.dir);
      }
      var handle = function (err, list) {
        if (err) {
          errorMessage(err, packet);
          options.error && options.error(err);
          if (socket) {
            packet.model = null;
            socket.json.emit(listener, packet);
          }
          return;
        }
        if (list.length == 0) {
          options.success && options.success([]);
          if (socket) {
            packet.model = [];
            socket.json.emit(listener, packet);
          }
          return;
        }
        // if we got a list by external key, fix the list
        if (extKey) {
          _.each(list, function (val, i) {
            list[i] = type + ':' + val.substr(val.lastIndexOf('::') + 2);
          });
        }
        redisClient.mget(list, processRecords);
      }
      if (extKey) {
        redisClient.keys(args, handle);
      } else {
        redisClient.sort(args, handle);
      }
    },

    update : function(socket, packet, cb) {
        packet.options.method = 'updated';

        var self    = this,
            model   = packet.model,
            options = packet.options,
            type    = options.type,
            channel = options.channel,
            index   = options.indexProps,
            extKeys = options.extKeys,
            id      = model.id;

        if (!id) {
            console.log('update no id:');
            return;
        }
        var typeId = Sync._getTypeId(type, id);
        db.get(typeId, function(err, exists) {
            if (err || !exists) {
              options.error && options.error(err);
              return (errorMessage(err, packet));
            }
            model.dateModified = new Date().getTime();
            var data = JSON.stringify(model);
            var multi = db.multi();
            multi.set(typeId, data);
            // lets remove old indexes
            var oldModel = JSON.parse(exists);
            Sync._unsetIndexProps(model, type, index, multi);
            // and remove old external keys
            Sync._unsetExtKeys(model, oldModel, type, extKeys, multi);
            // then go over all our new index props and set them
            Sync._setIndexProps(model, type, index, multi);
            // and set new external keys
            Sync._setExtKeys(model, oldModel, type, extKeys, multi);
            // we always want to store the date indexes, but won't touch dateCreated
            multi.set(Sync._getSortKey(type, 'dateModified') + id, model.dateModified)
            multi.exec(function(err, isset) {
                if (err) {
                  options.error && options.error(err);
                  return (errorMessage(err, packet));
                }

                options.silent || self.publish(socket, packet, cb);
                options.success && options.success(packet.model);
                cb && cb(true);
            });

        });
    },

    // ###destroy
    // Remove the specified model from the database, only one model may be
    // removed at a time, passing a 'temporary' option will publish the change
    // without persisting to the database
    delete : function(socket, packet, cb) {
        packet.options.method = 'destroyed';

        var self    = this,
            model   = packet.model,
            options = packet.options,
            index   = options.indexProps,
            extKeys = options.extKeys,
            id      = model.id,
            type    = options.type,
            chan    = options.channel;

        var typeId = Sync._getTypeId(type, id);
        db.sismember(type, typeId, function(err, member) {
            if (err) {
              options.error && options.error(err);
              return (errorMessage(err, packet));
            }
            var multi = db.multi();
            if (member) {
                // Remove model from collection set
                multi.srem(type, id);
            }
            multi.del(typeId);
            // then go over all our index props and delete those too
            index.push('dateCreated');
            index.push('dateModified');
            Sync._unsetIndexProps(model, type, index, multi);
            // and don't forget the external keys
            Sync._unsetExtKeys(model, null, type, extKeys, multi);
            // execute
            multi.exec(function(err, result){
              if (err) {
                options.error && options.error(err);
                return (errorMessage(err, packet));
              }
              options.silent || self.publish(socket, packet, cb);
              options.success && options.success(packet.model);
              cb && cb(true);
            });
        });
    }
};
