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

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://socialdev/lib/unload+.js");

Cu.import("resource://gre/modules/Services.jsm", this);

const EXPORTED_SYMBOLS = ["loadStyles"];

/**
 * Load various packaged styles for the add-on and undo on unload
 *
 * @usage loadStyles(styles): Load specified styles
 * @param [array of strings] styles: Style files to load
 */
function loadStyles(baseUrl, styles) {
  let sss = Cc["@mozilla.org/content/style-sheet-service;1"].
            getService(Ci.nsIStyleSheetService);
  styles.forEach(function(fileName) {
    let fileURL = baseUrl + "data/styles/" + fileName + ".css";
    let fileURI = Services.io.newURI(fileURL, null, null);
    sss.loadAndRegisterSheet(fileURI, sss.USER_SHEET);
    unload(function() sss.unregisterSheet(fileURI, sss.USER_SHEET));
  });
}
