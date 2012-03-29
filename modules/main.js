/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *	Edward Lee <edilee@mozilla.com>
 *	Mark Hammond <mhammond@mozilla.com>
 *	Shane Caraveo <scaraveo@mozilla.com>
 */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/modules/unload+.js");
Cu.import("resource://socialdev/modules/watchWindows.js");
Cu.import("resource://socialdev/modules/sidebarWidget.js");

Cu.import("resource://socialdev/modules/servicewindow.js");

const EXPORTED_SYMBOLS = ["startup", "shutdown"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const isMac = Services.appinfo.OS == "Darwin";

function shutdown(data) {
  runUnloaders();
}

// In main we start up all the services and create
// a window watcher to attach the sidebar element
// to each window.

function startup(options) {
  try {
    _startup(options);
  }
  catch (ex) {
    Cu.reportError("socialapi startup failed: " + ex);
  }
}

function _startup(options) {
  // per-window initialization for socialdev
  watchWindows(function(aWindow) {
    try {
      // only attach the sidebar and toolbar stuff if this is not a popup window.
      // according to http://mxr.mozilla.org/mozilla-central/source/browser/base/content/browser.js#1360,
      // the simple check is if the toolbar is visible or not...
      if (!aWindow.toolbar.visible) {
        return;
      }
      let social = aWindow.social;

      // setup our widgets
      social.sidebar = new Sidebar(aWindow);
    }
    catch (e) {
      Cu.reportError("main.js window watcher failure:" + e);
    }
  });


};

