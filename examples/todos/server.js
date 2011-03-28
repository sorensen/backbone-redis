(function(){
    // Application Server
    // ------------------
    var express         = require('express'),
        connect         = require('connect'),
        jade            = require('jade'),
        Sync            = require('../../lib/backbone-redis'),
        app             = module.exports = express.createServer();

    // Configure Redis client
    Sync.configure(6379, '127.0.0.1', {
        maxReconnectionAttempts: 10
    });

    // Server configuration
    app.configure(function() {
        app.use(express.logger());
        app.use(express.bodyParser());   
        app.set('view engine', 'jade');
        app.set('view options', {layout: false});
        app.use(express.static(__dirname));
    });

    // Static assets
    app.get('/*.(js|css)', function(req, res) {
        res.sendfile('./'+req.url);
    });

    // Main Application
    app.get('/', function(req, res) {
        res.render('index', {
            locals: {
            }
        });
    });

    // Start your engines!
    app.listen(8080);
    Sync.listen(app);
    
})()
    