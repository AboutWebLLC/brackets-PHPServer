/*
 * Copyright (c) 2013 Jonathan Rowny. All rights reserved.
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


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, forin: true, maxerr: 50, regexp: true */
/*global define, $, brackets, XMLHttpRequest */

/**
 * PHPAgent tracks all dependencies loaded by the PHP document. Use
 * `wasDependencyRequested(url)` to query whether a resource was loaded.
 */
define(function PHPAgent(require, exports, module) {
    "use strict";
    
    var DocumentManager = brackets.getModule("document/DocumentManager");
    
    var _dependencies;
    var _baseUrl = "";
   
    /** Return the resource information for a given URL
     * @param {string} url
     */
    function wasDependencyRequested(path) {
        //remove any windows slashes
        return _dependencies && _dependencies[path.split("/").join("\\")];
    }
    
    /** Initialize the agent */
    function load() {
        _dependencies = {};
        var _load = new $.Deferred();
        
        //this is a special URL provided by the PHPServerDomain which returns the dependencies for a given document
        var liveDepURL = _baseUrl + "PHPServerDomain_loadDependencies?target=" + DocumentManager.getCurrentDocument().file.fullPath;
        var request = new XMLHttpRequest();
        request.open("GET", liveDepURL);
        request.onload = function onLoad() {
            //console.log(request.response);
            JSON.parse(request.response).forEach(function (item, index) {
                _dependencies[item] = true;
            });
            _load.resolve();
        };
        request.send(null);
        return _load.promise();
    }

    /** Unload the agent */
    function unload() {
    }
    
    function setBaseUrl(url) {
        _baseUrl = url;
    }

    // Export public functions
    exports.wasDependencyRequested = wasDependencyRequested;
    exports.setBaseUrl = setBaseUrl;
    exports.load = load;
    exports.unload = unload;
});