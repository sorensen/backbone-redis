[![build status](https://secure.travis-ci.org/sorensen/backbone-redis.png)](http://travis-ci.org/sorensen/backbone-redis)
# Backbone Redis


## Technologies

+ Node
+ Express
+ Backbone
+ Socket.io
+ Redis

## Installation

The project can be installed via NPM, or by cloning this repo into your project.

    npm install backbone-redis
    
or

    git clone git://github.com/sorensen/backbone-redis.git
    

## Server Configuration

    var express    = require('express'),
        Redis      = require('redis'),
        bbRedis    = require('../../'),
        browserify = require('browserify'),
        io         = require('socket.io'),
        server     = module.exports = express.createServer(),
        io         = io.listen(server);

    var db  = Redis.createClient(6379, '127.0.0.1'),
        pub = Redis.createClient(6379, '127.0.0.1'),
        sub = Redis.createClient(6379, '127.0.0.1')

    bbRedis.config({
        io        : io,
        database  : db,
        publish   : pub,
        subscribe : sub,
        listener  : 'backbone',
    });
    
    server.listen(8080);

You can also create schemas for your models, which will have 
hookable methods for you to intercept the data. The hookable
methods are `create`, `read`, `update`, `delete`, `subscribe`, 
and `unsubscribe`, each with both `pre` and `post` 
methods attached.
    
    var fooSchema = bbRedis.schema();
    
    fooSchema
        .pre('create', function(next, model, options, cb) {
            next(model, options, cb);
        })
        .post('create', function(next, model, options, cb) {
            next(model, options, cb);
        });
        .pre('subscribe', function(next, socket, options, cb) {
            next(socket, options, cb);
        })
        .post('subscribe', function(next, socket, options, cb) {
            next(socket, options, cb);
        });

    bbRedis.model('foo', fooSchema);

Just be sure the name you give for the schema matches the `type` 
attribute that you set on the Backbone model.
    
## Client Configuration

    <script src='/socket.io/socket.io.js'></script>
    <script src="/underscore.js"></script>
    <script src="/backbone.js"></script>

If you have cloned the repo, just serve the file.
Otherwise you can expose it to the client using `browserify`.

    <script src="/backbone.redis.js"></script>

    var socket = io.connect();
    
    bbRedis.config({
        io : socket,
        listener : 'message'
    });

    var Foo = Backbone.Model.extend({
        url  : 'foos',
        type : 'foo',
        sync : _.sync
    });
    
    var FooList = Backbone.Collection.extend({
        model: Todo,
        url  : 'todos',
        type : 'todo',
        sync : _.sync
    });

Now that there is something to work with, we can use all of the 
default Backbone methods

    FooList.fetch();
    FooList.subscribe({}, function(){
        FooList.create({
            data : 'lorem ipsum'
        })
        FooList.unsubscribe();
    });
