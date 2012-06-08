/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Shane Caraveo <scaraveo@mozilla.com>
 *
 * Utility methods for dealing with XHR involving safebrowsing and ssl verification.
 */

const {classes: Cc, interfaces: Ci, utils: Cu, manager: Cm} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

var SafeXHR = (function() {
  function isDevMode() {
    let enable_dev = false;
    try {
      enable_dev = Services.prefs.getBoolPref("safexhr.disabled");
    } catch(e) {}
    return enable_dev;
  }

  /**
   * isSafeURL
   *
   * given a url, see if it is in our malware/phishing lists.
   * Returns immediately, calling the callback when a result is known.
   * Callback gets one param, the result which will be non-zero
   * if the url is a problem.
   *
   * @param url string
   * @param callback function
   */
  function isSafeURL(aUrl, aCallback) {
    if (isDevMode()) {
      aCallback(true);
      return;
    }
    // callback gets zero if the url is not found
    // pills.ind.in produces a positive hit for a bad site
    // http://www.google.com/safebrowsing/diagnostic?site=pills.ind.in/
    // result is non-zero if the url is in the malware or phising lists
    let uri = Services.io.newURI(aUrl, null, null);
    var dbservice = Cc["@mozilla.org/url-classifier/dbservice;1"]
                        .getService(Ci.nsIUrlClassifierDBService);
    var handler = {
      onClassifyComplete: function(result) {
        aCallback(result);
      }
    }
    var classifier = dbservice.QueryInterface(Ci.nsIURIClassifier);
    var result = classifier.classify(uri, handler);
    if (!result) {
      // the callback will not be called back, do it ourselves
      aCallback(0);
    }
  }

  function isSecureChannel(channel) {
    // this comes from https://developer.mozilla.org/En/How_to_check_the_security_state_of_an_XMLHTTPRequest_over_SSL
    // although we are more picky about things (ie, secInfo MUST be a nsITransportSecurityInfo and a nsISSLStatusProvider)
    let secInfo = channel.securityInfo;
    if (!(secInfo instanceof Ci.nsITransportSecurityInfo) || ((secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_SECURE) != Ci.nsIWebProgressListener.STATE_IS_SECURE)) {
      Cu.reportError("Attempt to XHR from insecure location (securityState is not secure)");
      return false;
    }
    if (!(secInfo instanceof Ci.nsISSLStatusProvider)) {
      Cu.reportError("Attempt to XHR from insecure location (host has no SSLStatusProvider)");
      return false;
    }
    let cert = secInfo.QueryInterface(Ci.nsISSLStatusProvider)
               .SSLStatus.QueryInterface(Ci.nsISSLStatus).serverCert;
    let verificationResult = cert.verifyForUsage(Ci.nsIX509Cert.CERT_USAGE_SSLServer);
    if (verificationResult != Ci.nsIX509Cert.VERIFIED_OK) {
      Cu.reportError("Attempt to XHR from insecure location (SSL status of host is invalid)");
      return false;
    }
    return true;
  }

  function XHR(url, async, callback) {
    // BUG 732264 error and edge case handling
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.open('GET', url, async);
    xhr.onreadystatechange = function(aEvt) {
      if (xhr.readyState == 4) {
        if (xhr.status == 200 || xhr.status == 0) {

          // We implicitly trust resource:// origins.
          let needSecure = !isDevMode() && url.indexOf("resource://") != 0;
          if (needSecure && !isSecureChannel(xhr.channel)) {
            if (callback) callback(false);
            return;
          }
          try {
            callback(JSON.parse(xhr.responseText))
          }
          catch(e) {
            Cu.reportError("Error while loading data from "+url+": "+e);
            dump(e.stack+"\n");
            if (callback) callback(false);
          }
        }
        else {
          Cu.reportError("Error while loading data from " + url + ": status "+xhr.status);
        }
      }
    };
    xhr.send(null);
  }

  return {
    get: function(url, async, callback) {
      isSafeURL(url, function(result) {
        if (result != 0) {
          Cu.reportError("Attempt to load social service from unsafe location (safebrowsing result: ["+result+"] "+url + ")");
          if (callback) callback(false);
          return;
        }
        XHR(url, async, callback);
      });
    },
    isSecureChannel: isSecureChannel,
    isSafeURL: isSafeURL
  }
})();

const EXPORTED_SYMBOLS = ['SafeXHR'];
