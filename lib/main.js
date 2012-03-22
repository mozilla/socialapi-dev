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

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/unload+.js");
Cu.import("resource://socialdev/lib/watchWindows.js");
// we just import about.js, it initializes itself
Cu.import("resource://socialdev/lib/about.js");
Cu.import("resource://socialdev/lib/sidebarWidget.js");
Cu.import("resource://socialdev/lib/toolbarButtonWidget.js");
Cu.import("resource://socialdev/lib/recommendButtonWidget.js");
Cu.import("resource://socialdev/lib/registry.js");

Cu.import("resource://socialdev/lib/servicewindow.js");
Cu.import("resource://socialdev/lib/loadStyles.js");

const EXPORTED_SYMBOLS = ["startup", "shutdown"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const isMac = Services.appinfo.OS == "Darwin";

function shutdown(data) {
  runUnloaders();
}

function mainLog(msg) {
  console.log(new Date().toISOString() + " [socialdev]: " + msg);
}

// In main we start up all the services and create
// a window watcher to attach the sidebar element
// to each window.
//
// We also declare a single document-element-inserted
// watcher, which checks each new browser to see
// if it requires API injection.
let injectController;

function startup(options) {
  try {
    _startup(options);
  } catch (ex) {
    mainLog("startup failed:"+ ex);
  }
}

function _startup(options) {
  // Load styles to allow for css transitions
  loadStyles("resource://socialdev/", ["browser"]);

  let registry = providerRegistry();

  // per-window initialization for socialdev
  watchWindows(function(aWindow) {
    try {
      // only attach the sidebar and toolbar stuff if this is not a popup window.
      // according to http://mxr.mozilla.org/mozilla-central/source/browser/base/content/browser.js#1360,
      // the simple check is if the toolbar is visible or not...
      if (!aWindow.toolbar.visible) {
        return;
      }
      let social = aWindow.social = {};

      // setup our widgets
      social.sidebar = new Sidebar(aWindow);
      social.toolbarButton = new ToolbarButton(aWindow);
      social.recommendButton = new RecommendButton(aWindow);

    } catch (e) {
      mainLog("window watcher failure:" + e);
      mainLog(e.stack);
    }
  });

  injectController = function(doc, topic, data) {
    try {
      // if we have attached 'service' on to the social-browser for the window
      // then we'll continue our injection.
      if (!doc.defaultView) return;
      var xulWindow = doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
      // our service windows simply have browser attached to them
      var sbrowser = xulWindow.document.getElementById("social-status-sidebar-browser") || xulWindow.browser;
      if (sbrowser && sbrowser.contentDocument == doc) {
        let service = sbrowser.service? sbrowser.service : xulWindow.service;
        service.attachToWindow(doc.defaultView, createServiceWindow);
      }
    } catch(e) {
      mainLog("unable to attachToWindow for "+doc.location);
      console.log(e.stack);
    }
  };
  Services.obs.addObserver(injectController, 'document-element-inserted', false);

  // wait till we've setup everything before kicking off
  registry.init();
};

