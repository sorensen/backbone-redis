/**
 * Server only override for Backbone.sync, enabling us to directly talk to redis
 * without a socket.
 */

var _ = require('underscore');
var Sync = require('backbone-redis');
var Backbone = require('backbone');

// Error and debug settings
var showError = false,
  showDebug = false;

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

var myRedis = {

  read: function (socket, packet, options) {
    var model = packet.model,
      options = packet.options,
      type = model.type,
      chan = options.channel;

    // Check to see if a specific model was requested based on 'id',
    // otherwise search the collection with the given parameters
    if (model.id) {
      redisClient.get(model.id, function (err, doc) {
        if (err) {
          errorMessage(err, packet);
          options.error(err);
          return;
        }
        if (!doc) {
          debugMessage('get', packet);
        }
        options.success(JSON.parse(doc));
      });
      return;
    }
    redisClient.smembers(type, function (err, list) {
      if (err) {
        errorMessage(err, packet);
        options.error(err);
        return;
      }
      if (list.length == 0) {
        options.success([]);
        return debugMessage('smembers', packet);
      }

      redisClient.mget(list, function (err, result) {
        if (err) {
          errorMessage(err, packet);
          options.error(err);
          return;
        }
        if (!result) {
          errorMessage('no collection items found for list: ' + JSON.stringify(list));
          return debugMessage('mget', packet);
        }

        // Send client the model data
        var collection = _.map(result, function (record) {
          return JSON.parse(record);
        });
        options.success(collection);
      });
    });
  }
}

var sync = function (method, model, options) {

  if (typeof redisClient == 'undefined') { throw new Error("redis client must be configured!"); }
  var resp;

  options     || (options = {});
  options.channel = model.getChannel();
  options.type  = model.type;

  var data = {
    model: model,
    options: options
  }
  
  switch (method)
  {
    // only reading will need to be overwritten, as it's the only method
    // writing it's result to a socket
    case "read":
      return myRedis.read(null, data, options);
    // the rest we simply plug onto backbone-redis
    case "create":
      return Sync.create(null, data, options.success);
    case "update":
      return Sync.update(null, data, options.success);
    case "delete":
      return Sync.delete(null, data, options.success);
  }
  var err = 'method: ' + method + ' does not exist!';
  console.log(err);
  options.error(err);
};

module.exports = sync;
