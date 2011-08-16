
// Application Server
// ------------------
require.paths.unshift('../../lib');

// Project dependencies
var express      = require('express'),
    Redis        = require('redis'),
    support   = require('../../'),
    browserify   = require('browserify'),
    io           = require('socket.io'),
    server       = module.exports = express.createServer(),
    io           = io.listen(server);

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
// send to the DNode pubsub middleware
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

support.config({
    io        : io,
    database  : db,
    publish   : pub,
    subscribe : sub,
    listener  : 'backbone',
    safeMode  : true,
    showDebug : true,
    showError : true
});

model = support
    .schema({
        content : '',
        order   : '',
        done    : ''
    })
    .pre('create', function(next, sock, data, cb) {
        console.log('todo-pre-create');
        next(sock, data, cb);
    })
    .pre('read', function(next, sock, data, cb) {
        console.log('todo-pre-read');
        next(sock, data, cb);
    })
    .pre('update', function(next, sock, data, cb) {
        console.log('todo-pre-update');
        next(sock, data, cb);
    })
    .pre('delete', function(next, sock, data, cb) {
        console.log('todo-pre-delete');
        next(sock, data, cb);
    })
    .pre('subscribe', function(next, sock, data, cb) {
        console.log('todo-pre-subscribe');
        next(sock, data, cb);
    })
    .pre('unsubscribe', function(next, sock, data, cb) {
        console.log('todo-pre-unsubscribe');
        next(sock, data, cb);
    })
    .pre('publish', function(next, sock, data, cb) {
        console.log('todo-pre-publish');
        next(sock, data, cb);
    })
    .model('todo', model);
    

var Todo = Backbone.Model.extend({

    // Server communication settings
    url  : 'todos',
    type : 'todo',
    sync : _.sync,

    // Default attributes for the todo.
    defaults: {
        content: "empty todo...",
        done: false,
    },

    // Ensure that each todo created has `content`.
    initialize: function() {
      if (!this.get("content")) {
        this.set({"content": this.defaults.content});
      }
    },

    // Toggle the `done` state of this todo item.
    toggle: function() {
        this.save({done: !this.get("done")});
    },

    // Remove this Todo from *localStorage* and delete its view.
    clear: function() {
        this.destroy();
    }

});

var TodosList = Backbone.Collection.extend({
    model: Todo,
    url  : 'todos',
    type : 'todo',
    sync : _.sync
});

var Todos = new TodoList;

Todos.bind('add', function((todo) {
    console.log('todo added', todo);
});

Todos.bind('reset', function(todos) {
    console.log('todo reset', todos);
});

Todos.subscribe({}, function() {
    console.log('todos subscribed');
    
    Todos.fetch();
    
    Todos.create({
        content: 'server',
        done : false
    });
});


server.listen(8080);
