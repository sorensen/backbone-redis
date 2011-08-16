[1mdiff --git a/browser/backbone.redis.js b/browser/backbone.redis.js[m
[1mindex 710e61b..501d57d 100644[m
[1m--- a/browser/backbone.redis.js[m
[1m+++ b/browser/backbone.redis.js[m
[36m@@ -17,7 +17,7 @@[m
     var socket;[m
 [m
     // Default socket event listener[m
[31m-    var listener = 'backbone';[m
[32m+[m[32m    var listener = 'message';[m
 [m
     // Storage container for subscribed models, allowing the returning method[m
     // calls from the server know where and how to find the model in question[m
[1mdiff --git a/examples/server.js b/examples/server.js[m
[1mindex 01b56be..c2eac0e 100644[m
[1m--- a/examples/server.js[m
[1m+++ b/examples/server.js[m
[36m@@ -93,6 +93,67 @@[m [mmodel = support[m
         next(sock, data, cb);[m
     })[m
     .model('todo', model);[m
[32m+[m[41m    [m
[32m+[m
[32m+[m[32mvar Todo = Backbone.Model.extend({[m
[32m+[m
[32m+[m[32m    // Server communication settings[m
[32m+[m[32m    url  : 'todos',[m
[32m+[m[32m    type : 'todo',[m
[32m+[m[32m    sync : _.sync,[m
[32m+[m
[32m+[m[32m    // Default attributes for the todo.[m
[32m+[m[32m    defaults: {[m
[32m+[m[32m        content: "empty todo...",[m
[32m+[m[32m        done: false,[m
[32m+[m[32m    },[m
[32m+[m
[32m+[m[32m    // Ensure that each todo created has `content`.[m
[32m+[m[32m    initialize: function() {[m
[32m+[m[32m      if (!this.get("content")) {[m
[32m+[m[32m        this.set({"content": this.defaults.content});[m
[32m+[m[32m      }[m
[32m+[m[32m    },[m
[32m+[m
[32m+[m[32m    // Toggle the `done` state of this todo item.[m
[32m+[m[32m    toggle: function() {[m
[32m+[m[32m        this.save({done: !this.get("done")});[m
[32m+[m[32m    },[m
[32m+[m
[32m+[m[32m    // Remove this Todo from *localStorage* and delete its view.[m
[32m+[m[32m    clear: function() {[m
[32m+[m[32m        this.destroy();[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m});[m
[32m+[m
[32m+[m[32mvar TodosList = Backbone.Collection.extend({[m
[32m+[m[32m    model: Todo,[m
[32m+[m[32m    url  : 'todos',[m
[32m+[m[32m    type : 'todo',[m
[32m+[m[32m    sync : _.sync[m
[32m+[m[32m});[m
[32m+[m
[32m+[m[32mvar Todos = new TodoList;[m
[32m+[m
[32m+[m[32mTodos.bind('add', function((todo) {[m
[32m+[m[32m    console.log('todo added', todo);[m
[32m+[m[32m});[m
[32m+[m
[32m+[m[32mTodos.bind('reset', function(todos) {[m
[32m+[m[32m    console.log('todo reset', todos);[m
[32m+[m[32m});[m
[32m+[m
[32m+[m[32mTodos.subscribe({}, function() {[m
[32m+[m[32m    console.log('todos subscribed');[m
[32m+[m[41m    [m
[32m+[m[32m    Todos.fetch();[m
[32m+[m[41m    [m
[32m+[m[32m    Todos.create({[m
[32m+[m[32m        content: 'server',[m
[32m+[m[32m        done : false[m
[32m+[m[32m    });[m
[32m+[m[32m});[m
 [m
 [m
 server.listen(8080);[m
[1mdiff --git a/lib/backbone-redis.js b/lib/backbone-redis.js[m
[1mindex c1189cc..cfe0436 100644[m
[1m--- a/lib/backbone-redis.js[m
[1m+++ b/lib/backbone-redis.js[m
[36m@@ -10,7 +10,7 @@[m [mvar pub,[m
     db;[m
 [m
 // Default socket event listener[m
[31m-var listener = 'backbone';[m
[32m+[m[32mvar listener = 'message';[m
 [m
 // Socket.io connection reference[m
 var conn;[m
[36m@@ -40,6 +40,12 @@[m [mif (typeof exports !== 'undefined') {[m
     var hooks = require('hooks');[m
 }[m
 [m
[32m+[m[32mfunction Message(opt) {[m
[32m+[m[32m    this.model   = opt.model;[m
[32m+[m[32m    this.options = opt.options;[m
[32m+[m[32m    this.options.type && (this.type = this.options.type);[m
[32m+[m[32m}[m
[32m+[m
 // Error and debug handlers[m
 //-------------------------[m
 [m
warning: CRLF will be replaced by LF in examples/server.js.
The file will have its original line endings in your working directory.
