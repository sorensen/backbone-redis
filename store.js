(function() {
    // Backbone storage
    // ----------------
    
    // Transport methods for model storage, sending data 
    // through the socket instance to be saved on the server
    var Store;
    
    // Exported for both CommonJS and the browser.
    if (typeof exports !== 'undefined') {
        _        = require('underscore')._;
        Backbone = require('backbone');
        Store = module.exports  = {};
    } else {
        Store = this.Store  = {};
    }
    
    Store = this.Store = function(options) {
        this.options = options || {};
        
        this.host = this.options.host || window.location.hostname;
        this.port = this.options.port || 8080;

        this.handlers    = {};
        this.state       = "disconnected";
        this.meta        = this.options.meta;

        this.socket = new io.Socket(this.host,
            {rememberTransport : false, port : this.port, secure : this.options.secure}
        );
        this.socket.on("connect",    this.proxy(this.onconnect));
        this.socket.on("message",    this.proxy(this.onmessage));
        this.socket.on("disconnect", this.proxy(this.ondisconnect));

        this.on("connect", this.proxy(this.writeMeta));
    };
    
    
    _.extend(Store.prototype, {
    
        proxy : function(func) {
            var thisObject = this;
            return(function() { 
                return func.apply(thisObject, arguments); 
            });
        },

        on : function(name, callback) {
            if ( !name || !callback ) return;
            if ( !this.handlers[name] ) this.handlers[name] = [];
            this.handlers[name].push(callback);
        },
        
        bind : Store.on,

        write : function(message) {
            if (typeof message.toJSON == "function")
                message = message.toJSON();

            this.socket.send(message);
        },

        connect : function() {
            if (this.state == "connected" || this.state == "connecting") return;

            this.state = "connecting";
            this.socket.connect();
        },

        subscribe : function(channel, callback) {
            if ( !channel ) throw "Must provide a channel";

            this.on(channel + " :data", callback);

            var connectCallback = this.proxy(function() {
                var message     = new Store.Message();
                message.type    = "subscribe";
                message.channel = channel;

                this.write(message);
            });

            this.on("connect", connectCallback);

            if (this.state == "connected") {
                connectCallback();
            } else {
                this.connect();
            }
        },

        unsubscribe : function(channel) {
            if ( !channel ) throw "Must provide a channel";
            
            var message        = new Store.Message();
            message.type    = "unsubscribe";
            message.channel = channel;

            this.write(message);
        },
        
        // Method to syncronize the client and server data.
        // This method will create listeners on the socket for 
        // the given key. Modeled after Store.subscribe() 
        sync : function(key, collection, name, method, model, callback) {
            if ( !key )            throw "Must provide a key";
            if ( !name )        throw "Must provide a name";
            
            // Wait for the server to return the connectCallback data
            this.on("sync :" + collection + " :data", callback);
            
            // This method will fire off when Store receives a socket 
            // transport from the server matching the key for 'this.on()'
            var connectCallback = this.proxy(function() {
                var message         = new Store.Message();
                message.type        = "sync";
                message.key         = key;
                message.collection  = collection;
                message.name        = name;
                message.method      = method;
                message.model       = model;
                // Send the data through the socket
                this.write(message);
            });
            
            // Add function to connect listeners
            this.on("connect", connectCallback);    
            
            // Check for connection
            if (this.state == "connected") {
                // Execute callback
                connectCallback();
            } else {
                // Make a connection
                this.connect();
            }
        },

        // Private
        trigger : function() {
            var args = [];
            for (var f=0; f < arguments.length; f++) args.push(arguments[f]);
            
            var name    = args.shift();

            var callbacks = this.handlers[name];
            if ( !callbacks ) return;

            for(var i=0, len = callbacks.length; i < len; i++)
                callbacks[i].apply(this, args);
        },

        writeMeta : function() {
            if ( !this.meta ) return;
            var message        = new Store.Message();
            message.type    = "meta";
            message.data    = this.meta;
            this.write(message);
        },

        onconnect : function() {
            this.sessionID = this.socket.transport.sessionid;
            this.state = "connected";
            this.trigger("connect");
        },

        ondisconnect : function() {
            this.state = "disconnected";
            this.trigger("disconnect");

            if ( this.options.reconnect !== false )
                this.reconnect();
        },

        onmessage : function(data) {
            var message = Store.Message.fromJSON(data);
            this.trigger("message", message);
            
            // Redis subscriptions
            if (message.channel) {
                var publish;
                if (message.data instanceof Object) publish = message.data;
                else publish = JSON.parse(message.data);
                this.trigger("sync :" + message.channel + " :data", publish);
            }
            // Direct socket messages
            else if (message.collection) {
                this.trigger("sync :" + message.collection + " :data", message);
            }
            else if (message.key) {
                this.trigger("sync :" + message.key + " :data", message);
            }
        },

        reconnect : function() {
            if (this.recInterval) return;

            var clear = function() {
                clearInterval(this.recInterval);
                this.recInterval = null;
            };

            this.recInterval = setInterval(this.proxy(function() {
                if (this.state == "connected") clear();
                else {
                    this.trigger("reconnect");
                    this.connect();
                }
            }), 3000);
        },
    
    });

    Store.Message = function(hash) {
        for (var key in hash) if (key) this[key] = hash[key];
    };
    
    _.extend(Store.Message, {
    
        fromJSON : function(json) {
            return(new this(JSON.parse(json)));
        },
        
    });
    
    _.extend(Store.Message.prototype, {
    
        toJSON : function() {
            var object = {};
            for (var key in this) {
                if (typeof this[key] != "function")
                    object[key] = this[key];
            }
            return(JSON.stringify(object));
        },
    });

    // Default URL for the model's representation on the server -- if you're
    // using Backbone's restful methods, override this to change the endpoint
    // that will be called.
    Backbone.Model.prototype.url = function() {
        var getUrl = function(object) {
            if (!(object && object.url)) return null;
            return _.isFunction(object.url) ? object.url() : object.url;
        };
        var base = getUrl(this.collection) || this.urlRoot || urlError();
        if (this.isNew()) return base;
        return base + (base.charAt(base.length - 1) == ' :' ? '' : ' :') + encodeURIComponent(this.id);
    };
    
    // Override `Backbone.sync` to use delegate to the model or collection's
    // *localStorage* property, which should be an instance of `Store`.
    Backbone.sync = function(method, model, options) {
        var getUrl = function(object) {
            if (!(object && object.url)) return null;
            return _.isFunction(object.url) ? object.url() : object.url;
        };
               
        var url = options.url || getUrl(model);
        var curl = (model instanceof Backbone.Model) ? getUrl(model.collection) : url;
        var name = model.storage || model.collection.storage;
        var syncMethod = '';
        
        // We will only get a direct response on a read
        if (method !== "read") delete options;
        
        switch (method) {        
            case "create" :  syncMethod = "create"; break;            
            case "read" :
                if (model.id) {
                    window.store.subscribe(url,function() {});
                    syncMethod = "find";
                    break;
                }
                window.store.subscribe(curl,function() {});
                syncMethod = "findAll";
                break;
                
            case "update" : syncMethod = "update"; break;            
            case "delete" : syncMethod = "destroy"; break;
        };
        var syncCallback;
        
        // We will only need the callback method on a 'read', which creates 
        // the syncronization channel in Store/redis, all new actions 
        // will be routed through this callback.  On non-reads the client 
        // only needs to tell the server what needs to be done
        syncCallback = (method !== "read") ? function() {} : function(results) {        
            if (!results) {
                options.error("Record not found");
                return;
            }
            var serverModel;                
            if (results instanceof Store.Message) {
                serverModel = JSON.parse(results.model);
            }
            else if (results.model instanceof Object) serverModel = results.model;
            else serverModel = JSON.parse(results);
            
            // Is this a generated server event?
            if (results.method !== syncMethod) {
            
                // We can assume that the subscription was made on the 'READ'
                // event, which serves as the transport for updates from other 
                // users on the application, re-delegate incomming server methods
                if (model instanceof Backbone.Model) {
                
                    // Perform model actions
                    switch (results.method) {
                        case "create"  : throw "Cannot create model without collection"; break;                  
                        case "update"  : model.set(serverModel); break;                    
                        case "destroy" : model.view.remove(); break;
                    }
                    return;
                }
                
                // Perform collection actions
                switch (results.method) {
                    case "create"  : model.add(serverModel); break;                    
                    case "update"  : model.get(serverModel).set(serverModel); break;                    
                    case "destroy" : model.remove(serverModel); break;
                }
                return;
            }
            options.success(serverModel);
            
            delete options;
            delete serverModel;
        };
              
        window.store.sync(url, curl, name, syncMethod, model, syncCallback);
    };    
})()