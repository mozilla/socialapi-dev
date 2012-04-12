"use strict";

Cu.import("resource://socialdev/modules/baseWidget.js");

function isInstalled() {
  // Tests if we have providers installed; this allows us to differentiate
  // between "disabled and no providers" versus "disabled but with installed
  // providers.
  let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                   .getService(Ci.mozISocialRegistry);
  return !!registry.currentProvider; // XXX - is this the correct check?
}


// These are widgets than can be created only after we become enabled.
// The toolbar widget is always created at startup so isn't here...
let widgetMap = {
  recommendButton: SocialRecommendButton,
  sidebar: SocialSidebar,
};

// A "fake" widget - never shown, just leverages the observer stuff from
// baseWidget.

// the short-lived singleton
let _stateWidget;

function stateWidget() {
  baseWidget.call(this, window);
}

stateWidget.prototype = {
  __proto__: baseWidget.prototype,

  enable: function() {
    dump("social initial enable\n")
    window.social.enabled = true;
    // get the default provider so we can set them on the widgets.
    let provider = Cc["@mozilla.org/socialProviderRegistry;1"]
                 .getService(Ci.mozISocialRegistry)
                 .currentProvider;

    for (let name in widgetMap) {
      if (typeof window.social[name] === "undefined") {
        try {
          let w = window.social[name] = new widgetMap[name](window);
          w.enable();
          w.setProvider(provider);
        } catch (ex) {
          Cu.reportError(ex);
        }
      }
    }
    // If we started up in the "not installed" state we might not have the
    // toolbar widget, so check that.
    if (!window.social.toolbarStatusArea) {
      window.social.toolbarStatusArea = new SocialToolbarStatusArea(window);
    }

    // once we've done this once we never need to do it again, so remove
    // ourself (and thus our observers etc)
    this.remove();
    _stateWidget = null;
  },
};

function social_main() {
  window.social = {};
  // due to what we are doing in the sidebar, we have to wait for the
  // chromeWindow to load before we do our magic
  window.addEventListener('load', function loadHandler(e) {
    window.removeEventListener('load', loadHandler);
    let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);

    // XXX this should be in a proper preferences.js
    if (!prefBranch.prefHasUserValue("enabled")) prefBranch.setBoolPref("enabled", false);
    let _enabled;
    window.social = {
      get enabled() {
        return _enabled;
      },
      set enabled(val) {
        if (_enabled != val) {
          _enabled = val;
          prefBranch.setBoolPref("enabled", val);
          // let our widgets know.
          let topic = val ? "social-browsing-enabled" : "social-browsing-disabled";
          Services.obs.notifyObservers(null, topic, null);
          // let the UI know.
          let broadcaster = document.getElementById("socialEnabled");
          broadcaster.setAttribute("checked", val ? "true" : "false");
          broadcaster.setAttribute("hidden", val ? "false" : "true");
          // another flag to indicate if we have providers "installed" (ie,
          // the UI might change if disabled and no providers installed,
          // versus disabled but with providers installed.)
          // For now, assume we can't become enabled if not installed...
          let installed = val || isInstalled();
          broadcaster = document.getElementById("socialInstalled");
          broadcaster.setAttribute("checked", installed ? "true" : "false");
          broadcaster.setAttribute("hidden", installed ? "false" : "true");
        }
      }
    };
    window.social.enabled = prefBranch.getBoolPref("enabled");
    if (isInstalled()) {
      window.social.toolbarStatusArea = new SocialToolbarStatusArea(window);
    }

    _stateWidget = new stateWidget();
    if (window.social.enabled) {
      _stateWidget.enable();
    }
    // if we are disabled so there is nothing to do - our "stateWidget"
    // will notice when we become enabled and bootstrap everything else.
  });
}

social_main();
