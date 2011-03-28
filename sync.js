(function() {
    // Backbone Redis Sync
    // -------------------
    
    // Supporting class for overriding Backbone.sync method
    // to allow for redis pub/sub through sockets via 
    // Juggernaut transports    
    var Sync;
    if (typeof exports !== 'undefined') {
        Sync = exports;
    } else {
        Sync = this.Sync = {};
    }
    
    // Dependancies
    red            = require('redis');
    rc            = red.createClient();
    redis       = require('redis-node');
    _           = require('underscore')._;
    io            = require("socket.io");
    crypto        = require("crypto");
    path        = require("path");
    fs            = require("fs");
    
    var credentials;
    
    // SSL Compatibility
    if (path.existsSync("keys/privatekey.pem")) {
        var privateKey  = fs.readFileSync("keys/privatekey.pem", "utf8");
        var certificate = fs.readFileSync("keys/certificate.pem", "utf8");
        credentials = crypto.createCredentials({key: privateKey, cert: certificate});
    }
    
    _.extend(Sync, {
    
        configure : function(options) {
            rc = redis.createClient(options);
        },
        
        // Attatch to Express server
        listen : function(app) {
            Sync.Publish.listen();
            if (credentials) {
                app.setSecure(credentials);
            }
            this.socket = io.listen(app);
            this.socket.on("connection", function(stream) {
                new Sync.Connection(stream);
            });
        },    
    
        // Redis publish (Taken from Juggernaut)
        publish : function(channel, data) {
            rc.publish('juggernaut', JSON.stringify({channel: channel, data: data}));
        },
        
        // Client disconnected (Juggernaut)
        disconnected : function(client) {
            if (!client.meta || !client.meta.disconnected) return;        
            _.each(client.meta.disconnected, function(action) {
                Sync.process(client, action);
            });
        },
        
        // Process
        // Main entry point to the Sync commands, route to another
        // method based on incoming data.method type
        process : function(client, data) {
            switch(data.method) {
                case "save":    Sync.save(client,    data); break;                            
                case "create":  Sync.create(client,  data); break;                            
                case "update":  Sync.update(client,  data); break;                            
                case "find":    Sync.find(client,    data); break;                            
                case "findAll": Sync.findAll(client, data); break;                            
                case "destroy": Sync.destroy(client, data); break;
            }
        },
    
        // Receives the current client and transported data
        // to be used for redis syncronization
        save : function(client, data) {
            // Need id to save
            if (!data.model.id) return;
            
            
            
            // Save to redis
            rc.set(data.key, JSON.stringify(data.model), function(err, isset) {    
                if (!isset) return;
                if (err) console.log("SET Error: " + err, err);
                if (data.collection) {
                
                    // Check for set member
                    rc.sismember(data.collection, data.model.id,  function(err, ismember) {
                        if (err) console.log("Redis Error: SISMEMBER: " + err, err);
                        if (ismember === 0) {
                        
                            // Add member to the collection set
                            rc.sadd(data.collection, data.model.id,  function(err, added) {
                                if (err) console.log("Redis Error: SADD: " + err, err);
                                if (!added) return;                            
                                Sync.updateCollection(client, data);
                            });
                        } else {
                            Sync.updateCollection(client, data);
                        }                    
                    });
                } else {
                    Sync.updateCollection(client, data);
                }
            });
        },
    
        // Create
        create : function(client, data) {
            if ( ! data.model.id) {
            
                // Generate the next redis id by model type to allow set transfers
                rc.incr('next.' + data.name + '.id', function(err, rid) {
                    if (err) console.log("Redis Error: INCR: " + err, err);                
                    // Give the model and transport key its new ID
                    data.model.id = rid;
                    data.key += ':' + rid;            
                    Sync.save(client, data);
                });
            } else {
                Sync.save(client, data);
            }
        },
    
        // Update
        update : function(client, data) {      
            // Publish to everyone
            Sync.save(client, data);
        },
    
        // Update
        updateModel : function(client, data) {      
            // Publish to everyone
            Sync.publish(data.key, data);
        },
        
        // Update
        updateCollection : function(client, data) {    
            // Publish to everyone
            Sync.publish(data.collection, data);
        },
        
        // Find
        find : function(client, data) {
            // ID must be set
            if (!data.model.id) return;
            
            // Check for set member
            if (data.collection) {
                rc.sismember(data.collection, data.model.id, function(check) {
                    if (check === 0) return;
                    
                    //Get record by key
                    rc.get(key, function(err, result) {
                        if (err) console.log("Redis Error: GET: " + err, err);
                        if (!results) return;
                        // Set the data and write to calling client
                        data.model = result;
                        client.connection.write(data);
                    });
                });
            } else {
                //Get record by key
                rc.get(key, function(err, result) {
                    if (err) console.log("Redis Error: GET: " + err, err);
                    if (!results) return;
                    
                    // Set the data and write to client
                    data.model = result;
                    client.connection.write(data);
                });
            }
        },
    
        // Find All
        findAll : function(client, data) {
            // Get model set members via collection
            rc.smembers(data.collection, function(err, list) {
                if (err) console.log('Redis Error: SMEMBERS: ' + err);
                if (!list) return;           
                return _(list)
                    .chain()
                    .map(function(member) {
                        var location = data.collection + ':' + member;
                        
                        //Get record by key
                        rc.get(location, function(err, result) {
                            if (err) console.log('Redis Error: GET:  ' + err);
                            if (!result) return;
                            
                            // Send client the model data
                            data.key = location;
                            data.model = result;
                            client.connection.write(data);
                            
                            // Set mapped value
                            return member = result;
                        });
                    });
            });
        },
        
        // Destroy
        destroy : function(client, data) {
            if (!data.key) data.key = data.collection + ":" + data.model.id;
            if (!data.model.id) return;
            
            // Check for set member
            if (data.collection) {
                rc.sismember(data.collection, data.model.id, function(err, member) {
                    if (err) console.log('Redis Error: SISMEMBER: ' + err,err);
                    if (member) {
                        // Remove model from collection set
                        rc.srem(data.collection, data.model.id, function(err, removed) {
                            if (err) console.log('Redis Error: SREM: ' + err,err);                        
                            rc.del(data.key, function(err, deleted) {                            
                                if (err) console.log('Redis Error: DEL: ' + err,err);
                                Sync.updateCollection(client, data);
                            });
                        });
                    } else {
                        // Delete model in redis
                        rc.del(data.key, function(err, deleted) {
                            if (err) console.log('Redis Error: DEL: ' + err,err);                        
                            Sync.updateCollection(client, data);
                        });
                    }
                });
            } else {
                // Delete model in redis
                rc.del(data.key, function(err, deleted) {
                    if (err) console.log('DEL Error: ' + err,err);                
                    Sync.updateCollection(client, data);
                });
            }
        },
    });
    
    // Connection constructor
    Sync.Connection = function(stream) {
        this.stream     = stream;
        this.session_id = this.stream.sessionId;
        this.client     = new Sync.Client(this);
        this.stream.on("message",      this.proxy(this.onmessage));
        this.stream.on("disconnect", this.proxy(this.ondisconnect));
    };
    
    // Socket connection wrapper
    _.extend(Sync.Connection, {
    
        proxy: function(func) {
            var thisObject = this;
            return(function() { 
                return func.apply(thisObject, arguments); 
            });
        }
    });
    
    _.extend(Sync.Connection.prototype, {
    
        onmessage : function(data) {
            console.log("Received: " + data);            
            var message = Sync.Message.fromJSON(data);
            switch (message.type) {
                case "subscribe":   this.client.subscribe(message.channel);     break;
                case "unsubscribe": this.client.unsubscribe(message.channel);   break;
                case "meta":        this.client.setMeta(message.data);          break;
                case "event":       this.client.event(message.data);            break;
                case "sync":        Sync.process(this.client, message);         break;
            }
        },
        
        ondisconnect : function() {
            this.client.disconnect();
        },
        
        write : function(message) {
            if (typeof message.toJSON == "function") {
                message = message.toJSON();
            }
            this.stream.send(message);
        },
        proxy: Sync.Connection.proxy
    });
    
    Sync.Client = function(conn) {
        this.connection = conn;
        this.session_id = this.connection.session_id;
    };
    
    _.extend(Sync.Client.prototype, {
    
        setMeta : function(value) {
            this.meta = value;
        },
        
        subscribe : function(name) {
            console.log("Client subscribing to: " + name);            
            var channel = Sync.Channel.find(name);
            channel.subscribe(this);
        },
        
        unsubscribe : function(name) {
            console.log("Client unsubscribing from: " + name);            
            var channel = Channel.find(name);
            channel.unsubscribe(this);
        },
        
        write : function(message) {
            if (message.except) {
                except = _.toArray(message.except)
                if (except.indexOf(this.session_id) != -1) {
                    return false;
                }
            }    
            this.connection.write(message);
        },    
        
        disconnect : function() {
            // Unsubscribe from all channels
            Sync.Channel.unsubscribe(this);
            Sync.disconnected(this);
        },
    });
    
    Sync.Channel = function(name) {
        this.name    = name;
        this.clients = [];
    };
    
    _.extend(Sync.Channel, {
    
        channels: {},
        
        find : function(name) {
            if ( !this.channels[name]) {
                this.channels[name] = new Sync.Channel(name);
            }
            return this.channels[name];
        },
        
        publish : function(message) {
            //var channels = message.getChannels();
            delete message.channels;
            
            var channels = [];
            channels.push(message.channel);            
            console.log(
                "Publishing to channels: " + 
                channels.join(", ") + " : " + message.data
            );
            for(var i=0, len = channels.length; i < len; i++) {
                message.channel = channels[i];
                var clients     = this.find(channels[i]).clients;
                
                for(var x=0, len2 = clients.length; x < len2; x++) {
                    clients[x].write(message);
                }
            }
        },
        
        unsubscribe: function(client) {
            for (var name in this.channels) {
                this.channels[name].unsubscribe(client);
            }
        }
    });
    
    _.extend(Sync.Channel.prototype, {
        
        subscribe: function(client) {
            this.clients.push(client);
            Sync.Events.subscribe(this, client);
        },
        
        unsubscribe: function(client) {
            if ( !_.include(this.clients, client)) {
                return;
            }
            this.clients = _.without(this.clients, client);
            Sync.Events.unsubscribe(this, client);
        }
        
    });
    
    Sync.Publish = {
    
        listen : function() {
            this.client = redis.createClient();
            this.client.subscribeTo("juggernaut", function(_, data) {
                console.log("Received: " + data);
                console.log(data);
                try {
                    var message = Sync.Message.fromJSON(data);
                    console.log("Channel publish: " + message,message);
                    Sync.Channel.publish(message);
                }
                catch(e) {
                    console.log(JSON.stringify(e)); 
                    return; 
                }
            });
        }
    };
    
    Sync.Message = function(hash) {
        for (var key in hash) {
            if (key) {
                this[key] = hash[key];
            }
        }
    };
    
    _.extend(Sync.Message, {
    
        fromJSON : function(json) {
            return(new this(JSON.parse(json)));
        }
    });
    
    _.extend(Sync.Message.prototype, {
    
        toJSON : function() {
            var object = {};
            for (var key in this) {
                if (typeof this[key] != "function") {
                    object[key] = this[key];
                }
            }
            return(JSON.stringify(object));
        },
        
        getChannels : function() {
            return(_.toArray(this.channels) || [this.channel]);
        },
        
        getChannel : function() {
            return(this.getChannels()[0]);
        }
        
    });
    
    
    Sync.Events = {
        
        client : redis.createClient(),
        
        publish : function(key, value) {
            this.client.publish("juggernaut:" + key, 
                JSON.stringify(value)
            );
        },
        
        subscribe : function(channel, client) {
            this.publish("subscribe", 
            {
                channel:    channel.name,
                meta:       client.meta,
                session_id: client.session_id
            });
        },
        
        unsubscribe : function(channel, client) {
            this.publish("unsubscribe",
            {
                channel:    channel.name,
                meta:       client.meta,
                session_id: client.session_id
            });
        }
    };
})()