/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
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
maxerr: 50, browser: true */
/*global $, define, brackets */

define(function (require, exports, module) {
    "use strict";

    var AppInit              = brackets.getModule("utils/AppInit"),
        ExtensionUtils       = brackets.getModule("utils/ExtensionUtils"),
        FileUtils            = brackets.getModule("file/FileUtils"),
        LiveDevServerManager = brackets.getModule("LiveDevelopment/LiveDevServerManager"),
        NodeConnection       = brackets.getModule("utils/NodeConnection"),
        ProjectManager       = brackets.getModule("project/ProjectManager"),
        LiveDevelopment      = brackets.getModule("LiveDevelopment/LiveDevelopment"),
        DocumentManager      = brackets.getModule("document/DocumentManager"),
        Inspector            = brackets.getModule("LiveDevelopment/Inspector/Inspector");
    /**
     * @const
     * Amount of time to wait before automatically rejecting the connection
     * deferred. If we hit this timeout, we'll never have a node connection
     * for the PHP server in this run of Brackets.
     */
    var NODE_CONNECTION_TIMEOUT = 30000; // 30 seconds
    
    /**
     * @private
     * @type{jQuery.Deferred.<NodeConnection>}
     * A deferred which is resolved with a NodeConnection or rejected if
     * we are unable to connect to Node.
     */
    var _nodeConnectionDeferred = $.Deferred();
    
    var _baseUrl = "";
    
    var _phpFileExts = ["php", "php3", "php4", "php5", "phtm", "phtml"];
 
    /**
     * @constructor
     */
    function PHPServerProvider() {}

    
     /**
     * Determine if file extension is a PHP file extension.
     * @param {String} file name with extension or just a file extension
     * @return {Boolean} Returns true if fileExt is in the list
     */
    function _isPHPFileExt(fileExt) {
        if (!fileExt) {
            return false;
        }

        var i = fileExt.lastIndexOf("."),
            ext = (i === -1 || i >= fileExt.length - 1) ? fileExt : fileExt.substr(i + 1);

        return (_phpFileExts.indexOf(ext.toLowerCase()) !== -1);
    }
    
    /**
     * Determines whether we can serve local file.
     * 
     * @param {String} localPath
     * A local path to file being served.
     *
     * @return {Boolean} 
     * true for yes, otherwise false.
     */
    PHPServerProvider.prototype.canServe = function (localPath) {

        if (!_nodeConnectionDeferred.isResolved()) {
            return false;
        }
        
        if (!ProjectManager.isWithinProject(localPath)) {
            return false;
        }

        // Url ending in "/" implies default file, which is usually index.php.
        // Return true to indicate that we can serve it.
        if (localPath.match(/\/$/)) {
            return true;
        }

        return _isPHPFileExt(localPath);
    };

    /**
     * Returns a base url for current project. 
     *
     * @return {String}
     * Base url for current project.
     */
    PHPServerProvider.prototype.getBaseUrl = function () {
        return _baseUrl;
    };

    /**
     * # LiveDevServerProvider.readyToServe()
     *
     * Gets the server details from the PHPServerDomain in node.
     * The domain itself handles starting a server if necessary (when
     * the phpServer.getServer command is called).
     *
     * @return {jQuery.Promise} A promise that resolves/rejects when 
     *     the server is ready/failed.
     */
    PHPServerProvider.prototype.readyToServe = function () {
        var readyToServeDeferred = $.Deferred();

        _nodeConnectionDeferred.done(function (nodeConnection) {
            if (nodeConnection.connected()) {
                nodeConnection.domains.phpServer.getServer(
                    ProjectManager.getProjectRoot().fullPath
                ).done(function (address) {
                    _baseUrl = "http://" + address.address + ":" + address.port + "/";
                    LiveDevelopment.agents.php.setBaseUrl(_baseUrl);
                    readyToServeDeferred.resolve();
                }).fail(function () {
                    _baseUrl = "";
                    LiveDevelopment.agents.php.setBaseUrl(_baseUrl);
                    readyToServeDeferred.reject();
                });
            } else {
                // nodeConnection has been connected once (because the deferred
                // resolved, but is not currently connected).
                //
                // If we are in this case, then the node process has crashed
                // and is in the process of restarting. Once that happens, the
                // node connection will automatically reconnect and reload the
                // domain. Unfortunately, we don't have any promise to wait on
                // to know when that happens. The best we can do is reject this
                // readyToServe so that the user gets an error message to try
                // again later.
                //
                // The user will get the error immediately in this state, and
                // the new node process should start up in a matter of seconds
                // (assuming there isn't a more widespread error). So, asking
                // them to retry in a second is reasonable.
                readyToServeDeferred.reject();
            }
        });
        
        _nodeConnectionDeferred.fail(function () {
            readyToServeDeferred.reject();
        });
        
        return readyToServeDeferred.promise();
    };

    /**
     * @private
     * @type{PHPServerProvider}
     * Stores the singleton PHPServerProvider for use in unit testing.
     */
    var _phpServerProvider = new PHPServerProvider();
    
    /**
     * @private
     * @return {PHPServerProvider} The singleton PHPServerProvider initialized
     * on app ready.
     */
    function _getPHPServerProvider() {
        return _phpServerProvider;
    }
    
     /** Triggered by a document saved from the DocumentManager */
    function _onDocumentSaved(event, doc) {
        if (doc && Inspector.connected() &&
                _isPHPFileExt(doc.extension) &&
                LiveDevelopment.agents.php &&
                LiveDevelopment.agents.php.wasDependencyRequested(doc.file.fullPath)) {
            // Reload HTML page
            Inspector.Page.reload();

            // Reload unsaved changes
            LiveDevelopment.reconnect();
        }
    }

    AppInit.appReady(function () {
        // Register as a Live Development server provider
        LiveDevServerManager.registerProvider(_phpServerProvider, 10);
        
        // Regiester an agent
        LiveDevelopment.agents.php = require("PHPAgent");
        LiveDevelopment.enableAgent("php");
        // Start up the node connection, which is held in the
        // _nodeConnectionDeferred module variable. (Use 
        // _nodeConnectionDeferred.done() to access it.
        var connectionTimeout = setTimeout(function () {
            console.error("[PHPServer] Timed out while trying to connect to node");
            _nodeConnectionDeferred.reject();
        }, NODE_CONNECTION_TIMEOUT);
        
        var _nodeConnection = new NodeConnection();
        _nodeConnection.connect(true).then(function () {
            _nodeConnection.loadDomains(
                [ExtensionUtils.getModulePath(module, "node/PHPServerDomain")],
                true
            ).then(
                function () {
                    clearTimeout(connectionTimeout);
                    _nodeConnectionDeferred.resolveWith(null, [_nodeConnection]);
                },
                function () { // Failed to connect
                    console.error("[PHPServer] Failed to connect to node", arguments);
                    _nodeConnectionDeferred.reject();
                }
            );
        });
    });
    
    function init() {
        $(DocumentManager).on("documentSaved", _onDocumentSaved);
    }
    
    init();
    
    // For unit tests only
    exports._getPHPServerProvider = _getPHPServerProvider;
});
