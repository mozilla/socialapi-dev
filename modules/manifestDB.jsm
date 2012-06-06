/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *  Dan Walkowski <dwalkowski@mozilla.com>
 *  Anant Narayanan <anant@kix.in>
 */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialapi/modules/typedStorage.jsm");

// a lightweight wrapper around TypedStorage to handle simple validation
// of origin keys and manifest data
var ManifestDB = (function() {
  var typedStorage = TypedStorage();
  var storage = typedStorage.open("manifest", "destiny");

  // get the host+port of the url to use as a db key
  function normalizeKey(aURL) {
    let URI = Services.io.newURI(aURL, null, null);
    if (URI.port > 0)
      return URI.host+":"+URI.port;
    return URI.host;
  }

  /**
   * add
   *
   * @param origin  url origin of the manifest
   * @param manifest  manifest record (js object)
   * @param cb      callback function
   */
  function put(origin, manifest, cb) {
    // TODO validate the manifest now?  what do we validate?
    manifest.last_modified = new Date().getTime();
    storage.put(normalizeKey(origin), manifest, cb);
  }

  function insert(origin, manifest, cb) {
    // TODO validate the manifest now?  what do we validate?
    manifest.last_modified = new Date().getTime();
    storage.insert(normalizeKey(origin), manifest, cb);
  }

  function remove(origin, cb) {
    var self = this;
    let originKey = normalizeKey(origin);
    storage.get(originKey, function(key, item) {
      if (!item) {
        if (cb) cb(false);
      }
      else {
        storage.remove(key, function() {
          if (cb) cb(true);
        });
      }
    });
  }

  function get(origin, cb) {
    storage.get(normalizeKey(origin), cb);
  }

  function iterate(cb) {
    storage.iterate(cb);
  }

  function close() {
    storage.close();
  }

  // an observer to ensure we shutdown the database, else debug builds assert.
  Services.obs.addObserver({
    observe: function(aSubject, aTopic, aData) {
      Services.obs.removeObserver(this, "quit-application-granted");
      close();
    }
  }, "quit-application-granted", false);

  return {
    insert: insert,
    iterate: iterate,
    put: put,
    remove: remove,
    get: get,
    close: close
  };
})();

var EXPORTED_SYMBOLS = ["ManifestDB"];
