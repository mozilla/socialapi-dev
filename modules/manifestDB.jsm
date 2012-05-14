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
Cu.import("resource://socialdev/modules/typedStorage.jsm");

// a lightweight wrapper around TypedStorage to handle simple validation
// of origin keys and manifest data
var ManifestDB = (function() {
  var typedStorage = TypedStorage();
  var storage = typedStorage.open("manifest", "destiny");

  // TODO:
  // given an origin, normalize it (like, http://foo:80 --> http://foo), or
  // https://bar:443 --> https://bar, or even http://baz/ --> http://baz)
  // Special treatment for resource:// URLs to support "builtin" apps - for
  // these, the "origin" is considered to be the *path* to the .webapp - eg,
  // "resource://foo/bar/app.webapp" is considered to be
  // "resource://foo/bar" - thus, any services etc for such apps must be
  // under resource://foo/bar"
  // XXX - is this handling of builtin apps OK???
  function normalizeOrigin(aURL) {
    try {
      let uri = Services.io.newURI(aURL, null, null);
      if (uri.scheme == 'resource') return aURL;
      return uri.host;
    }
    catch(e) {
      // this function is regularly called with just the origin (ie, no
      // leading http:// etc), so regularly reports failure to normalize.
      // We probably need to rethink this (ie, this code should either be
      // used always with a scheme or always without it.
      // for now though there is no point reporting the "error"...
      //Cu.reportError(e);
    }
    return aURL;
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
    origin = normalizeOrigin(origin);
    manifest.last_modified = new Date().getTime();
    manifest.origin = origin;
    storage.put(origin, manifest, cb);
  }

  function insert(origin, manifest, cb) {
    // TODO validate the manifest now?  what do we validate?
    origin = normalizeOrigin(origin);
    manifest.last_modified = new Date().getTime();
    manifest.origin = origin;
    storage.insert(origin, manifest, cb);
  }

  function remove(origin, cb) {
    var self = this;
    origin = normalizeOrigin(origin);
    storage.get(origin, function(item) {
      if (!item) {
        cb(false);
      }
      else {
        storage.remove(origin, function() {
          cb(true);
        });
      }
    });
  }

  function get(origin, cb) {
    origin = normalizeOrigin(origin);
    storage.get(origin, cb);
  }

  function iterate(cb) {
    storage.iterate(cb);
  }

  return {
    insert: insert,
    iterate: iterate,
    put: put,
    remove: remove,
    get: get
  };
})();

var EXPORTED_SYMBOLS = ["ManifestDB"];
