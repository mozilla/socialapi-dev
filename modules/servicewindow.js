/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *  Edward Lee <edilee@mozilla.com>
 *  Mark Hammond <mhammond@mozilla.com>
 *  Shane Caraveo <scaraveo@mozilla.com>
 */

/*
* A window containing a single browser instance for use by social providers.
*/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const EXPORTED_SYMBOLS = ["createServiceWindow", "closeWindowsForService", "serviceWindowMaker"];

Cu.import("resource://gre/modules/Services.jsm");

const isMac = Services.appinfo.OS == "Darwin";
const isWin = Services.appinfo.OS == "WINNT";

var xulNs = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
var xhtmlNs = "http://www.w3.org/1999/xhtml";

const SOCIAL_WINDOWTYPE = "socialapi:window";


function serviceWindowMaker(options) {
  /* We now pass the options.url, which is the user app directly
    inserting it in the window, instead using the xul browser element
    that was here. This helped to make the session history work. */
  options.wrappedJSObject = options;

  let ww = Cc["@mozilla.org/embedcomp/window-watcher;1"]
    .getService(Ci.nsIWindowWatcher);
  // due to a conflict between some of the features which can be specified
  // (notably the size options) and the XUL layout, we ignore features
  // provided by the provider and use ones we know to work.
  let features = "minimizable=yes,dialog=no,resizable=yes,scrollbars=yes";
  var window = ww.openWindow(null, 'chrome://socialapi/content/serviceWindow.xul',
                             options.name, features, options);

  // We catch the first DOMContentLoaded, which means the XUL
  // document has loaded.
  var onXULReady = function(evt) {
    // for windows where we may have an app button.
    let appButton = window.document.getElementById("appmenu-button");
    if (appButton) {
      appButton.setAttribute("label", options.title || '');
    }
    if (options.onClose) {
      window.addEventListener("unload", function(e) {
        if (e.target == window.document) {
          options.onClose();
        }
      }, false);
    }
    if (options.onReady) options.onReady();
  }

  window.addEventListener("DOMContentLoaded", onXULReady, false);
  return window;
}

function wrapServiceWindowForContent(aWindow)
{
  return {
    close: function() {
      aWindow.browser.contentWindow.close();
    },
    get closed() {
      return aWindow.closed;
    },
    focus: function() {
      aWindow.browser.contentWindow.focus();
    },
    loadURI: function(URI) {
      aWindow.browser.setAttribute("src", URI);
    },
    setTitle: function(title) {
      aWindow.document.title = title;
    }
  }
}

// Passed to services to allow them to create new windows for themselves.
function createServiceWindow(toURL, name, options, withService, title, readyCallback)
{
  // toURL must be same-origin as provider
  let toURI = Services.io.newURI(toURL, null, null);
  if (withService.origin != toURI.prePath && toURI.prePath.indexOf("resource:") != 0) {
    throw new Error("service window url must be same-origin as provider");
  }

  // See if we've already got one...
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    let sWindow = windows.getNext();
    if (sWindow.wrappedJSObject.service == withService && sWindow.wrappedJSObject.name == name) {
      if (readyCallback) readyCallback();
      return wrapServiceWindowForContent(sWindow);
    }
  }

  let opts = {
      features: options,
      name: name,
      url: toURL,
      title:title,

    onClose: function() {
    },

    onReady: function() {
      try {
        if (aWind.browser.contentWindow.location.href != toURL) {
          return;
        }
        aWind.browser.service = withService;
        if (readyCallback) readyCallback();
      }
      catch(e) {
        Cu.reportError(e);
      }
    }

  };
  var aWind = serviceWindowMaker(opts);
  aWind.service = withService;
  aWind.name = name;
  return wrapServiceWindowForContent(aWind);
}


function closeWindowsForService(aService)
{
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    let window = windows.getNext();
    let {documentElement} = window.document;
    if (documentElement.getAttribute("windowtype") == SOCIAL_WINDOWTYPE) {
      if (window.service == aService) {
        window.close();
      }
    }
  }
}
