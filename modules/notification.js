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
* This is a quick-and-dirty shim of the notification API that already
* exists in Fennec; a proper notification system would require more user
* controls, rate limiting, queuing, etc.
*/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

function addNotification(aNotification, aSecurityOrigin)
{
  var alertsService = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);

  alertsService.showAlertNotification(aNotification._iconUrl,
      aNotification._title,
      aNotification._body,
      false, // text clicakble
      null, // cookie
      null, // listener
      null); // name
}

function cancelNotification(aNotification)
{

}

function Notification(iconUrl, title, body) {
  var self= {};
  self._iconUrl = iconUrl;
  self._title = title;
  self._body = body;
  self.show = function() {
    addNotification(this, this._domain);
  }
  self.cancel = function() {
    cancelNotification(this, this._domain);
  }
  return self;
}

function createAmbientNotification(service) {
  // need to return per-service accessors...
  return {
    setBackground: function(background) {
      service.setAmbientNotificationBackground(background);
    },
    
    createNotificationIcon: function(name) {
      return service.createAmbientNotificationIcon(name);
    },

    setPortrait: function(url) {
      service.setAmbientNotificationPortrait(url);
    }

  }
}

var EXPORTED_SYMBOLS = ["addNotification", "Notification", "createAmbientNotification"];
