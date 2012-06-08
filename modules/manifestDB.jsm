/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *  Shane Caraveo <scaraveo@mozilla.com>
 *  Mark Hammond <mhammond@mozilla.com>
 */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialapi/modules/SafeXHR.jsm");


/**
 * getDefaultProviders
 *
 * look into our addon/feature dir and see if we have any builtin providers to install
 */
function getBuiltinProviders() {
  var URIs = [];
  try {
    // figure out our installPath
    let res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    let installURI = Services.io.newURI("resource://socialapi/", null, null);
    let installPath = res.resolveURI(installURI);
    let installFile = Services.io.newURI(installPath, null, null);
    try {
      installFile = installFile.QueryInterface(Components.interfaces.nsIJARURI);
    } catch (ex) {} //not a jar file

    // load all prefs in defaults/preferences into a sandbox that has
    // a pref function
    let resURI = Services.io.newURI("resource://socialapi/providers", null, null);
    // If we're a XPI, load from the jar file
    if (installFile.JARFile) {
      let fileHandler = Components.classes["@mozilla.org/network/protocol;1?name=file"].
                  getService(Components.interfaces.nsIFileProtocolHandler);
      let fileName = fileHandler.getFileFromURLSpec(installFile.JARFile.spec);
      let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].
                      createInstance(Ci.nsIZipReader);
      try {
        zipReader.open(fileName);
        let entries = zipReader.findEntries("providers/*");
        while (entries.hasMore()) {
          var entryName = resURI.resolve(entries.getNext());
          if (entryName.indexOf("app.manifest") >= 0)
            URIs.push(entryName);
        }
      }
      finally {
        zipReader.close();
      }
    }
    else {
      let fURI = resURI.QueryInterface(Components.interfaces.nsIFileURL).file;

      var entries = fURI.directoryEntries;
      while (entries.hasMoreElements()) {
        var entry = entries.getNext();
        entry.QueryInterface(Components.interfaces.nsIFile);
        if (entry.leafName.length > 0 && entry.leafName[0] != '.') {
          URIs.push(resURI.resolve("providers/"+entry.leafName+"/app.manifest"));
        }
      }
    }
    //dump(JSON.stringify(URIs)+"\n");
  } catch(e) {
    Cu.reportError(e);
  }
  return URIs
}


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
   * validateManifest
   *
   * Given the manifest data, create a clean version of the manifest.  Ensure
   * any URLs are same-origin (proto+host+port).  If the manifest is a builtin,
   * URLs must either be resource or same-origin resolved against the manifest
   * origin. We ignore any manifest entries that are not supported.
   *
   * @param location   string      string version of manifest location
   * @param manifest   json-object raw manifest data
   * @returns manifest json-object a cleaned version of the manifest
   */
  function validateManifest(location, rawManifest) {
    // anything in URLEntries will require same-origin policy, though we
    // special-case iconURL to allow icons from CDN
    let URLEntries = ['iconURL', 'workerURL', 'sidebarURL'];

    // only items in validEntries will move into our cleaned manifest
    let validEntries = ['name'].concat(URLEntries);

    // Is this a "built-in" service?
    let builtin = location.indexOf("resource:") == 0;
    if (builtin) {
      // builtin manifests may have a couple other entries
      validEntries = validEntries.concat('origin', 'contentPatchPath');
    }

    // store the location we got the manifest from and the origin.
    let manifest = {
      location: location
    };
    for (var k in rawManifest.services.social) {
      if (validEntries.indexOf(k) >= 0) manifest[k] = rawManifest.services.social[k];
    }
    // we've saved original location in manifest above, switch our location
    // temporarily so we can correctly resolve urls for our builtins.  We
    // still validate the origin defined in a builtin manifest below.
    if (builtin && manifest.origin) {
      location = manifest.origin;
    }

    // resolve all URLEntries against the manifest location.
    let basePathURI = Services.io.newURI(location, null, null);
    // full proto+host+port origin for resolving same-origin urls
    manifest.origin = basePathURI.prePath;
    for each(let k in URLEntries) {

      if (!manifest[k]) continue;

      // shortcut - resource:// URIs don't get same-origin checks.
      if (builtin && manifest[k].indexOf("resource:") == 0) continue;

      // resolve the url to the basepath to handle relative urls, then verify
      // same-origin, we'll let iconURL be on a different origin
      let url = basePathURI.resolve(manifest[k]);

      if (k != 'iconURL' && url.indexOf(manifest.origin) != 0) {
        throw new Error("manifest URL origin mismatch " +manifest.origin+ " != " + manifest[k] +"\n")
      }
      manifest[k] = url; // store the resolved version
    }
    return manifest;
  }

  // we want automatic updates to the manifest entry if we change our
  // builtin manifest files.   We also want to allow the "real" provider
  // to overwrite our builtin manifest, however we NEVER want a builtin
  // manifest to overwrite something installed from the "real" provider
  function installManifest(manifest, callback) {
    get(manifest.origin, function(key, item) {
      // dont overwrite a non-resource entry with a resource entry.
      if (item && manifest.location.indexOf('resource:') == 0 &&
                  item.location.indexOf('resource:') != 0) {
        // being passed a builtin and existing not builtin - ignore.
        if (callback) {
          callback(false);
        }
        return;
      }
      // dont overwrite enabled, but first install is always enabled
      manifest.enabled = item ? item.enabled : true;
      put(manifest.origin, manifest, function() {
        if (callback) {
          callback(true);
        }
      });
    });
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
    if (cb) cb(true);
  }

  function remove(origin, cb) {
    var self = this;
    let originKey = normalizeKey(origin);
    try {
      _prefBranch.clearUserPref(originKey);
      if (cb) cb(true);
    } catch(e) {
      if (cb) cb(false);
    }
  }

  function get(origin, cb) {
    try {
      let manifest = JSON.parse(_prefBranch.getCharPref(origin));
      if (cb) cb(origin, manifest);
    } catch(e) {
      if (cb) cb(origin, null);
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

  // load the builtin providers if any
  let URIs = getBuiltinProviders();
  for each(let uri in URIs) {
    // for now, do this synchronously
    SafeXHR.get(uri, false, function(data) {
      let manifest = validateManifest(uri, data);
      installManifest(manifest);
    });
  }

  return {
    validate: validateManifest,
    install: installManifest,
    iterate: iterate,
    put: put,
    remove: remove,
    get: get
  };
})();

var EXPORTED_SYMBOLS = ["ManifestDB"];
