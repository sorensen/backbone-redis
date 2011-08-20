
// Application Server
// ------------------
require.paths.unshift('../../lib');

// Project dependencies
var express    = require('express'),
    Redis      = require('redis'),
    bbRedis    = require('../../'),
    browserify = require('browserify'),
    io         = require('socket.io'),
    server     = module.exports = express.createServer(),
    io         = io.listen(server);

// Configuration settings
var redisConfig  = {
    port : 6379,
    host : '127.0.0.1',
    options : {
        parser : 'javascript',
        return_buffer : false
    },
};

// Create the publish and subscribe clients for redis to
// send to the pubsub middleware
var db  = Redis.createClient(redisConfig.port, redisConfig.host, redisConfig.options),
    pub = Redis.createClient(redisConfig.port, redisConfig.host, redisConfig.options),
    sub = Redis.createClient(redisConfig.port, redisConfig.host, redisConfig.options)

// Server configuration, set the server view settings to
// render in jade, set the session middleware and attatch
// the browserified bundles to the app on the client side.
server.configure(function() {
    server.use(express.bodyParser());
    server.use(express.methodOverride());
    server.use(express.static(__dirname + '/../../'));
    server.use(express.static(__dirname));
    server.use(express.errorHandler({
        dumpExceptions : true,
        showStack      : true
    }));
});

// Main application
server.get('/', function(req, res) {
    res.render(__dirname + '/index.html');
});

db.flushall();

bbRedis.config({
    io        : io,
    database  : db,
    publish   : pub,
    subscribe : sub,
    listener  : 'backbone',
    safeMode  : true,
    showDebug : true,
    showError : true
});


model = bbRedis.schema()

    // All CRUD events can be intercepted before being
    // processed, allowing us to do validation, or anything
    // else to ensure data integrity, ect...
    .pre('create', function(next, model, options, cb) {
        console.log('todo-pre-create');
        next(model, options, cb);
    })
    .pre('read', function(next, model, options, cb) {
        console.log('todo-pre-read');
        next(model, options, cb);
    })
    .pre('update', function(next, model, options, cb) {
        console.log('todo-pre-update');
        next(model, options, cb);
    })
    .pre('delete', function(next, model, options, cb) {
        console.log('todo-pre-delete');
        next(model, options, cb);
    })

    // Subscribe events will pass in the current client's 
    // socket connection instead of the model
    .pre('subscribe', function(next, socket, options, cb) {
        console.log('todo-pre-subscribe');
        next(socket, options, cb);
    })
    .pre('unsubscribe', function(next, socket, options, cb) {
        console.log('todo-pre-unsubscribe');
        next(socket, options, cb);
    });

bbRedis.model('todo', model);


server.listen(8080);
