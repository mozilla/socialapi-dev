/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is trusted.js; substantial portions derived
 * from XAuth code originally produced by Meebo, Inc., and provided
 * under the Apache License, Version 2.0; see http://github.com/xauth/xauth
 *
 * Contributor(s):
 *     Michael Hanson <mhanson@mozilla.com>
 *     Dan Walkowski <dwalkowski@mozilla.com>
 *     Anant Narayanan <anant@kix.in>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/lib/typedStorage.jsm");

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
    } catch(e) {
      dump(e+"\n");
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
      } else {
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
