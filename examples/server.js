
// backbone-redis server to server demonstration
// ---------------------------------------------

require.paths.unshift('../../lib');

// Project dependencies
var express    = require('express'),
    Redis      = require('redis'),
    browserify = require('browserify'),
    Backbone   = require('backbone'),
    _          = require('underscore'),
    bbRedis    = require('../'),
    io         = require('socket.io'),
    server     = module.exports = express.createServer(),
    io         = io.listen(server);

// Redis configuration settings
var redisConfig  = {
    port : 6379,
    host : '127.0.0.1',
    options : {
        parser : 'javascript',
        return_buffer : false
    },
};

// Create the publish and subscribe clients for redis to
// send to the `backbone-redis` package
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

// Configure the package, explicitly passing in all `redis` 
// and `socket.io` references, allowing us to configure the 
// clients before hand. The `listener` will be the socket 
// event that all handlers will be listening and broadcasting 
// to. The `safeMode` flag will tell the package to only act 
// upon model `types` that have a registered schema for them.
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

// Create a new schema with `backbone-redis`, which will add 
// in `hook` support for more fine-grained control
var model = bbRedis.schema()

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

// Register the schema with `backbone-redis`, giving it the 
// same name as the model `type` attribute
bbRedis.model('todo', model);
    

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

var TodoList = Backbone.Collection.extend({
    model: Todo,
    url  : 'todos',
    type : 'todo',
    sync : _.sync
});

var Todos = new TodoList;

Todos
    // Bind to the basic CRUD events, just so we can see that 
    // the events are in fact propegating correctly
    .bind('add', function(todo) {
        console.log('todo added');
    })
    .bind('reset', function(todos) {
        console.log('todo reset');
    })
    .bind('destroy', function(todos) {
        console.log('todo removed');
    })
    .bind('change', function(todos) {
        console.log('todo changed');
    })

    // Bind to the pubsub events, these are custom events that 
    // are triggered by `backbone-redis` for support
    .bind('subscribe', function(data) {
        console.log('todo subscribed', data);
    })
    .bind('unsubscribe', function(data) {
        console.log('todo unsubscribed', data);
    });

// Fetch the models, issuing a `read` event trough the model 
// or collections `sync` method that has been overriden, or 
// `Backbone.sync` if you have set it globally, this does not 
// require a subscription to be used
Todos.fetch();

// It is not necessary to be `subscribed` to a given model 
// or collection to create a new one, however, the event 
// will be published through `redis` and we will receive the 
// update that all other clients will get
Todos.create({
    content: 'server',
    done : false
});

// Subscribe to the collection, telling `backbone-redis` to 
// inform us of all changes made to models with the given `type`,
// you can pass in some `options` as the first parameter to 
// specify the `type` or `channel` if you want. Of course these 
// will automatically be calculated if left blank. You can also 
// pass in a `override` boolean to force a new subscription, 
// since by default it will only ever happen once per model `type`
Todos.subscribe({}, function() {
    console.log('todos subscribed');
    
    // Create another model, this time we will receive the update, 
    // used inside the `subscribe` callback to ensure that we are 
    // in fact, subscribed to it
    Todos.create({
        content: 'subbed-server',
        done : false
    });

    // All done here
    Todos.unsubscribe();
});

// Start em up!
server.listen(8000);
