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

// a lightweight wrapper around prefs for manifest storage
var ManifestDB = (function() {
  var _prefBranch = Services.prefs.getBranch("social.manifest.").QueryInterface(Ci.nsIPrefBranch2);;

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
    _prefBranch.setCharPref(normalizeKey(origin), JSON.stringify(manifest));
    cb(true);
  }

  function insert(origin, manifest, cb) {
    // TODO validate the manifest now?  what do we validate?
    manifest.last_modified = new Date().getTime();
    let key = normalizeKey(origin);
    try {
      _prefBranch.getCharPref(key);
      cb(false);
    } catch(e) {
      _prefBranch.setCharPref(key, JSON.stringify(manifest));
      cb(true);
    }
  }

  function remove(origin, cb) {
    var self = this;
    let originKey = normalizeKey(origin);
    try {
      _prefBranch.clearUserPref(originKey);
      cb(true);
    } catch(e) {
      cb(false);
    }
  }

  function get(origin, cb) {
    try {
      let key = normalizeKey(origin);
      let manifest = JSON.parse(_prefBranch.getCharPref(key));
      cb(key, manifest);
    } catch(e) {
      cb(key, null);
    }
  }

  function iterate(cb, finalize) {
    let manifests;
    try {
      manifests = _prefBranch.getChildList("",{});
      for each(let key in manifests) {
        this.get(key, cb);
      }
    } catch(e) {
      Cu.reportError(e);
    }
    finalize(manifests.length);
  }

  function close() {}

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
