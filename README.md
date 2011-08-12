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
    

## NodeJS Server Configuration

To begin using the module, you must first create an express server, configure the 
redis server that you will be using, and then to tell 'Sync' to listen to the app, 
which is basically a wrapper for the Socket.io listen() method.

    var express         = require('express'),
        Sync            = require('sync'),
        app              = module.exports = express.createServer();

Configure Redis client

    Sync.configure(6379, '127.0.0.1', {
        maxReconnectionAttempts: 10
    });
    
Listen to the express server
    
    Sync.listen(app);
    

## Client Configuration

Setting up on the client is just as easy, we are basically setting the Socket.io port
that we will be using for data transmition.

    window.store = new Store({
        port : 8080,
        secure : ('https :' == document.location.protocol)
    });
    

Thats it! The point of the module is to override Backbone.sync and provide a seamless 
interface to data persistance.
