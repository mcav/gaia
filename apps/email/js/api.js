/**
 * Load the email backend (asynchronously).
 */
'use strict';
/*global define, GelamLoader */
define('api', function(require, exports, module) {
  var callback;

  exports.whenLoaded = function(cb) {
    callback = cb;
  };
  exports.MailAPI = null; // Asynchronously loaded.

  // We're in Gaia now, so GELAM is not in standalone mode.
  GelamLoader.config({
    standalone: false
  });

  // Asynchronously spin up the backend, and give us a reference to
  // MailAPI that we can pass onward.
  GelamLoader.loadMailAPI(function(MailAPI) {
    exports.MailAPI = MailAPI;
    callback && callback(MailAPI);
  });
});

