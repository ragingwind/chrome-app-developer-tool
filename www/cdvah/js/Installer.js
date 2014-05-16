/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
*/
(function(){
    'use strict';
    /* global myApp, cordova */
    myApp.factory('Installer', ['$q', 'UrlRemap', 'ResourcesLoader', 'PluginMetadata', 'CacheClear', function($q, UrlRemap, ResourcesLoader, PluginMetadata, CacheClear) {

        function getAppStartPageFromConfig(configFile) {
            return ResourcesLoader.readFileContents(configFile)
            .then(function(contents) {
                if(!contents) {
                    throw new Error('Config file is empty. Unable to find a start page for your app.');
                } else {
                    var startLocation = 'index.html';
                    var parser = new DOMParser();
                    var xmlDoc = parser.parseFromString(contents, 'text/xml');
                    var els = xmlDoc.getElementsByTagName('content');

                    if(els.length > 0) {
                        // go through all 'content' elements looking for the 'src' attribute in reverse order
                        for(var i = els.length - 1; i >= 0; i--) {
                            var el = els[i];
                            var srcValue = el.getAttribute('src');
                            if (srcValue) {
                                startLocation = srcValue;
                                break;
                            }
                        }
                    }

                    return startLocation;
                }
            });
        }

        function Installer(url, appId) {
            this.url = url;
            this.appId = appId || '';
            this.updatingStatus = null;
            this.lastUpdated = null;
            this.installPath = null;
            this.plugins = {};
        }

        Installer.prototype.type = '';

        Installer.prototype.updateApp = function(installPath) {
            var self = this;
            this.updatingStatus = 0;
            this.installPath = installPath;
            // Cache clearing necessary only for Android.
            return CacheClear.clear()
            .then(function() {
                return self.doUpdateApp();
            })
            .then(function() {
                self.lastUpdated = new Date();
                return self.getPluginMetadata();
            }, null, function(status) {
                self.updatingStatus = Math.round(status * 100);
            }).then(function(metadata) {
                self.plugins = PluginMetadata.process(metadata);
                var pluginIds = Object.keys(metadata);
                var newPluginsFileData = PluginMetadata.createNewPluginListFile(pluginIds);
                return ResourcesLoader.writeFileContents(installPath + '/www/cordova_plugins.js', newPluginsFileData);
            }).finally(function() {
                self.updatingStatus = null;
            });
        };

        Installer.prototype.doUpdateApp = function() {
            throw new Error('Installer ' + this.type + ' failed to implement doUpdateApp.');
        };

        Installer.prototype.getPluginMetadata = function() {
            throw new Error('Installer ' + this.type + ' failed to implement getPluginMetadata.');
        };

        Installer.prototype.deleteFiles = function() {
            this.lastUpdated = null;
            if (this.installPath) {
                return ResourcesLoader.deleteDirectory(this.installPath);
            }
            return $q.when();
        };

        Installer.prototype.unlaunch = function() {
            return UrlRemap.reset();
        };

        Installer.prototype.launch = function() {
            var installPath = this.installPath;
            var appId = this.appId;
            if (!installPath) {
                throw new Error('App ' + appId + ' requires an update');
            }
            var configLocation = installPath + '/config.xml';

            return getAppStartPageFromConfig(configLocation)
            .then(function(rawStartLocation) {
                var urlutil = cordova.require('cordova/urlutil');
                var harnessUrl = urlutil.makeAbsolute(location.pathname);
                var harnessDir = harnessUrl.replace(/\/[^\/]*\/[^\/]*$/, '');
                var installUrl = urlutil.makeAbsolute(installPath);
                var startLocation = urlutil.makeAbsolute(rawStartLocation).replace('/cdvah/', '/');
                var useNativeStartLocation = cordova.platformId == 'ios';

                // Use toNativeURL() so that scheme is file:/ instead of cdvfile:/ (file: has special access).
                return ResourcesLoader.toNativeURL(installUrl)
                .then(function(nativeInstallUrl) {
                    nativeInstallUrl = nativeInstallUrl.replace(/\/$/, '');
                    // Point right at the dest. location on iOS.
                    if (useNativeStartLocation) {
                        startLocation = startLocation.replace(harnessDir, nativeInstallUrl + '/www');
                    }

                    // Override cordova.js, and www/plugins to point at bundled plugins.
                    UrlRemap.aliasUri('^(?!app-harness://).*/www/cordova\\.js.*', '.+', 'app-harness:///cordova.js', false /* redirect */, true /* allowFurtherRemapping */);
                    UrlRemap.aliasUri('^(?!app-harness://).*/www/plugins/.*', '^.*?/www/plugins/' , 'app-harness:///plugins/', false /* redirect */, true /* allowFurtherRemapping */);

                    // Make any references to www/ point to the app's install location.
                    var harnessPrefixPattern = '^' + harnessDir.replace('file:///', 'file://.*?/');
                    UrlRemap.aliasUri(harnessPrefixPattern, harnessPrefixPattern, nativeInstallUrl + '/www', false /* redirect */, true /* allowFurtherRemapping */);

                    // Set-up app-harness: scheme to point at the harness.
                    UrlRemap.aliasUri('^app-harness:///cdvah/index.html', '^app-harness://', harnessDir, true, false);
                    return UrlRemap.aliasUri('^app-harness:', '^app-harness://', harnessDir, false, false)
                    .then(function() {
                        return startLocation;
                    });
                });
            });
        };
        return Installer;
    }]);
})();
