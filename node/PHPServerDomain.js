/*
 * Copyright (c) 2012 Jonathan Rowny. All rights reserved.
 *
 * Parts (the PHP handling) of this server were borrowed from: https://github.com/phw/phpnode
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4,
maxerr: 50, node: true */
/*global */

(function () {
    "use strict";
    
    var http    = require("http"),
        connect = require("connect"),
        fs = require('fs'),
        path = require('path'),
        url = require('url'),
        mime = require('mime'),
        cgi = require('cgi'),
        events = require('events');

    var PHP_EXECUTABLE = 'php-cgi';
    var DEFAULT_INDEX = ['index.php', 'index.html'];


    /**
     * When Chrome has a css stylesheet replaced over live development,
     * it re-checks any image urls in the new css stylesheet. If it has
     * to hit the server to check them, this is asynchronous, so it causes
     * two re-layouts of the webpage, which causes flickering. By setting
     * a max age of five seconds, Chrome won't bother to hit the server
     * on each keystroke. So, flickers will happen at most once every five
     * seconds.
     *
     * @const
     * @type {number}
     */
    var STATIC_CACHE_MAX_AGE = 5000; // 5 seconds
    
    /**
     * @private
     * @type {Object.<string, http.Server>}
     * A map from root paths to server instances.
     */
    var _servers = {};
    
    /**
     * Determine if file extension is a PHP file extension.
     * @param {String} file name with extension or just a file extension
     * @return {Boolean} Returns true if fileExt is in the list
     */
    var _phpFileExts = ["php", "php3", "php4", "php5", "phtm", "phtml"];
    function _isPHPFileExt(fileExt) {
        if (!fileExt) {
            return false;
        }

        var i = fileExt.lastIndexOf("."),
            ext = (i === -1 || i >= fileExt.length - 1) ? fileExt : fileExt.substr(i + 1);

        return (_phpFileExts.indexOf(ext.toLowerCase()) !== -1);
    }
    
    /**
     * @private
     * @type {DomainManager}
     * The DomainManager passed in at init.
     */
    var _domainManager = null;

    /**
     * @private
     * Helper function to create a new server.
     * @param {string} path The absolute path that should be the document root
     * @param {function(?string, ?httpServer)} cb Callback function that receives
     *    an error (or null if there was no error) and the server (or null if there
     *    was an error). 
     */
    function _createServer(path, createCompleteCallback) {
        //TODO, it'd be better if this were handled as connect middleware
        var IndexResolver = function () {
            events.EventEmitter.call(this);
        
            var that = this;
        
            this.resolve = function (path) {
                fs.lstat(path, function (err, stats) {
                    if (err || !stats) {
                        notFound();
                        return;
                    }
        
                    if (stats.isFile()) {
                        found(path);
                    } else if (stats.isDirectory()) {
                        findDirectoryIndex(path);
                    } else {
                        notFound();
                    }
                });
            };
        
            function findDirectoryIndex(path) {
            // We use synchronous requests here to avoid a too deep callstack.
                for (var i = 0; i < DEFAULT_INDEX.length; i++) {
                    var filePath = path + '/' + DEFAULT_INDEX[i];
            
                    try {
                    var stats = fs.lstatSync(filePath);
            
                    if (stats.isFile()) {
                        //console.log('Using index file ' + filePath);
                        found(filePath);
                        return;
                    }
                }
                catch (err) {
                //console.log('No index file ' + filePath);
                }
            }
        
            notFound();
            }
        
            function found(filePath) {
            that.emit('found', filePath);
            }
        
            function notFound() {
            that.emit('notFound');
            }
        };
        require('util').inherits(IndexResolver, events.EventEmitter);
        
        function handleStaticFile(filePath, res) {
            var contentType = mime.lookup(filePath);
            //console.log('Serving ' + filePath + ' (' + contentType + ')');
            
            fs.lstat(filePath, function(err, stats) {
            if (stats.isDirectory()) {
                filePath += '/' + 'index.html';
            }
        
            fs.readFile(filePath, function(error, content) {
                    if (error) {
                res.writeHead(500);
                res.end();
                    }
                    else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
                    }
            });
            });
        }
        
        
        function handlePhpScript(req, res, filePath) {
            var reqUrl = url.parse(req.url);
            //console.log('Processing PHP ' + filePath);
        
            var env = {};
            env.REDIRECT_STATUS = 200;
            env.DOCUMENT_ROOT = path;
            env.SCRIPT_FILENAME = filePath;
            env.REQUEST_URI = req.url;
            env.REMOTE_ADDR = req.connection.remoteAddress;
            env.REMOTE_PORT = req.connection.remotePort;
            //console.log(env);
            req.resume();
            cgi(PHP_EXECUTABLE, { env: env, stderr: process.stdout })(req, res);
        }
        function requestHandler(req, res) {
            // We have to pause the request right away, since
            // the body data will be read in the cgi module.
            req.pause();
            var requestUrl = url.parse(req.url);
            var filePath = path + requestUrl.pathname.substring(1);
            
            //TODO: I should handle this in the resolver in case the target isn't found
            if(requestUrl.pathname.substring(1) == "PHPServerDomain_loadDependencies"){
                var targetName = "index.php";
                if(requestUrl.query && requestUrl.query.split("=")){
                    targetName = requestUrl.query.split("=")[1];
                }
                //use the built in LoadDepenencies.php file to find the target's dependencies
                req.url = '/LoadDependencies.php?target=' + targetName;
                handlePhpScript(req, res, __dirname + "\\LoadDependencies.php");
            }else{
            
                var resolver = new IndexResolver();
                resolver.on('found', function(filePath) {            
                    if (_isPHPFileExt(filePath)) {
                        handlePhpScript(req, res, filePath);
                    } else {
                        handleStaticFile(filePath, res);
                    }
                });
            
                resolver.on('notFound', function() {
                    res.writeHead(404, {'Content-Type': 'text/html'});
                    res.end("<h1>404</h1><strong>File not found,</strong> You may want to try <a href=\"index.php\">index.php</a> due to Bracket's Issue #2033. This 404 brought to you by the PHPServer Extension.<br/> File: " + filePath);
                });
            
                resolver.resolve(filePath);
            }
        };
        var server = http.createServer(requestHandler);
        server.listen(0, "127.0.0.1", function () {
            createCompleteCallback(null, server);
        });
    }

    var PATH_KEY_PREFIX = "LiveDev_";
    
    /**
     * @private
     * Handler function for the staticServer.getServer command. If a server
     * already exists for the given path, returns that, otherwise starts a new
     * one.
     * @param {string} path The absolute path that should be the document root
     * @param {function(?string, ?{address: string, family: string,
     *    port: number})} cb Callback that should receive the address information
     *    for the server. First argument is the error string (or null if no error),
     *    second argument is the address object (or null if there was an error).
     *    The "family" property of the address indicates whether the address is,
     *    for example, IPv4, IPv6, or a UNIX socket.
     */
    function _cmdGetServer(path, cb) {
        // Make sure the key doesn't conflict with some built-in property of Object.
        var pathKey = PATH_KEY_PREFIX + path;
        if (_servers[pathKey]) {
            cb(null, _servers[pathKey].address());
        } else {
            _createServer(path, function (err, server) {
                if (err) {
                    cb(err, null);
                } else {
                    _servers[pathKey] = server;
                    cb(null, server.address());
                }
            });
        }
    }
    
    /**
     * @private
     * Handler function for the phpServer.closeServer command. If a server
     * exists for the given path, closes it, otherwise does nothing. Note that
     * this function doesn't wait for the actual socket to close, since the
     * server will actually wait for all client connections to close (which can
     * be awhile); but once it returns, you're guaranteed to get a different
     * server the next time you call getServer() on the same path.
     *
     * @param {string} path The absolute path whose server we should close.
     * @return {boolean} true if there was a server for that path, false otherwise
     */
    function _cmdCloseServer(path, cba) {
        var pathKey = PATH_KEY_PREFIX + path;
        if (_servers[pathKey]) {
            var serverToClose = _servers[pathKey];
            delete _servers[pathKey];
            serverToClose.close();
            return true;
        }
        return false;
    }
    
    /**
     * Initializes the StaticServer domain with its commands.
     * @param {DomainManager} DomainManager The DomainManager for the server
     */
    function init(DomainManager) {
        _domainManager = DomainManager;
        if (!_domainManager.hasDomain("phpServer")) {
            _domainManager.registerDomain("phpServer", {major: 0, minor: 1});
        }
        _domainManager.registerCommand(
            "phpServer",
            "getServer",
            _cmdGetServer,
            true,
            "Starts or returns an existing server for the given path.",
            [{
                name: "path",
                type: "string",
                description: "absolute filesystem path for root of server"
            }],
            [{
                name: "address",
                type: "{address: string, family: string, port: number}",
                description: "hostname (stored in 'address' parameter), port, and socket type (stored in 'family' parameter) for the server. Currently, 'family' will always be 'IPv4'."
            }]
        );
        _domainManager.registerCommand(
            "phpServer",
            "closeServer",
            _cmdCloseServer,
            false,
            "Closes the server for the given path.",
            [{
                name: "path",
                type: "string",
                description: "absolute filesystem path for root of server"
            }],
            [{
                name: "result",
                type: "boolean",
                description: "indicates whether a server was found for the specific path then closed"
            }]
        );
    }
    
    exports.init = init;
    
}());
