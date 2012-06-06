"use strict";

Cu.import("resource://socialapi/modules/registry.js");
Cu.import("resource://socialapi/modules/provider.js");
Cu.import("resource://socialapi/modules/Discovery.jsm");

function isAvailable() {
  // This will probably go away based on UX - it exists so the social toolbar
  // is removed entirely when things are not available.

  // Tests if we have providers installed; this allows us to differentiate
  // between "disabled and no providers" versus "disabled but with installed
  // providers.
  // Only valid when social is globally disabled and relies on the fact the
  // registry will always return *something* as the currentProvider if
  // there are any currently enabled.
  return !!registry().currentProvider;
}

// These are widgets than can be created only after we become enabled.
// The toolbar widget is always created at startup so isn't here...
let widgetMap = {
  recommendButton: SocialRecommendButton,
  sidebar: SocialSidebar,
};

let stateObserver = {
  observe: function(aSubject, aTopic, aData) {
    if (aTopic == 'social-browsing-enabled') {
      // create all the delay-loaded widgets.
      // get the default provider so we can set them on the widgets.
      let provider = registry().currentProvider;

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
      // so the registry has enabled it - see if the doc state allows it.
      set_window_social_enabled_from_doc_state();
      return;
    }
    if (aTopic == 'social-browsing-disabled') {
      set_window_social_enabled(false);
      return;
    }
    if (aTopic == 'social-service-manifest-changed') {
      // this is just to help the isAvailable() check - if a service was
      // enabled/disabled it may be that the toolbar needs to be shown/hidden
      dump("got social-service-manifest-changed "+aData+"\n");
      set_window_social_enabled_from_doc_state();
      return;
    }
  }
}

function set_window_social_enabled_from_doc_state() {
  if (document.documentElement.getAttribute('disablechrome') ||
      document.documentElement.getAttribute('chromehidden').indexOf("extrachrome") >= 0) {
    // doesn't matter what the registry says - it's disabled in this window.
    set_window_social_enabled(false);
  } else {
    // It is allowed to be enabled here so use the global state.
    set_window_social_enabled(registry().enabled);
  }
}

function set_window_social_enabled(val) {
  dump("set_window_social_enabled "+val+"\n");
  window.social.enabled = val;
  // let the UI know.
  let broadcaster = document.getElementById("socialEnabled");
  broadcaster.setAttribute("checked", val ? "true" : "false");
  broadcaster.setAttribute("hidden", val ? "false" : "true");
  // another flag to indicate if we have providers "installed" (ie,
  // the UI changes if disabled and no providers installed,
  // versus disabled but with providers installed.)
  let installed = val || isAvailable();
  // If we started up in the "not installed" state we might not have the
  // toolbar widget, so check that.
  if (installed && !window.social.toolbarStatusArea) {
    window.social.toolbarStatusArea = new SocialToolbarStatusArea(window);
    window.social.toolbarStatusArea.enable();
    window.social.toolbarStatusArea.setProvider(registry().currentProvider);
  }
  broadcaster = document.getElementById("socialInstalled");
  broadcaster.setAttribute("checked", installed ? "true" : "false");
  broadcaster.setAttribute("hidden", installed ? "false" : "true");
  // and the sidebar state.
  let sideBarVisible;
  if (val) {
    // social is enabled so the sidebar visibility comes from the pref.
    let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
    sideBarVisible = prefBranch.getBoolPref("visible");
  } else {
    sideBarVisible = false;
  }
  let broadcaster = document.getElementById("socialSidebarVisible");
  if ((broadcaster.getAttribute("checked") == "true") != sideBarVisible) {
    broadcaster.setAttribute("checked", sideBarVisible ? "true" : "false");
    broadcaster.setAttribute("hidden", sideBarVisible ? "false" : "true");
    let topic = sideBarVisible ? "social-sidebar-visible" : "social-sidebar-hidden";
    Services.obs.notifyObservers(window, topic, null);
  }
}

// used by chrome to toggle the enabled state.
function social_toggle() {
  let reg = registry();
  reg.enabled = !reg.enabled
  dump("toggled the social brownsing\n");
}

// used by chrome to toggle the sidebar state.
function social_sidebar_toggle() {
  if (registry().enabled) {
    // ok, we can toggle it
    let broadcaster = document.getElementById("socialSidebarVisible");
    let newState = broadcaster.getAttribute("hidden") == "true";
    broadcaster.setAttribute("checked", newState ? "true" : "false");
    broadcaster.setAttribute("hidden", newState ? "false" : "true");
    // and set the pref.
    let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
    prefBranch.setBoolPref("visible", newState);
    let topic = newState ? "social-sidebar-visible" : "social-sidebar-hidden";
    Services.obs.notifyObservers(window, topic, null);
  } else {
    Cu.reportError("can't toggle the social sidebar if social is disabled!");
  }
}

function social_init() {
  if (window.social) return;
  dump("social_init called\n");

  window.social = {
    toggle: social_toggle,
    sidebar_toggle: social_sidebar_toggle
  };

  // watch for when browser disables chrome in tabs, and hide the social sidebar
  if ('MozMutationObserver' in window || 'MutationObserver' in window) {
    var observer = new (window.MutationObserver || window.MozMutationObserver)(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes') {
          set_window_social_enabled_from_doc_state();
        }
      });
    });
  } else {
    Cu.reportError("MozMutationObserver not available, falling back to DOMAttrModified");
    // bug 756674 not sure what version MozMutationObserver became available, keep the fallback
    document.addEventListener('DOMAttrModified', function(e) {
      if (e.target == document.documentElement &&
          (e.attrName == "disablechrome" || e.attrName == "chromehidden")) {
        set_window_social_enabled_from_doc_state();
      }
    }.bind(this));
    // and the initial startup state.
    set_window_social_enabled_from_doc_state();
  }

  if (registry().enabled || isAvailable()) {
    window.social.toolbarStatusArea = new SocialToolbarStatusArea(window);
  }

  Services.obs.addObserver(stateObserver, "social-browsing-enabled", false);
  Services.obs.addObserver(stateObserver, "social-browsing-disabled", false);
  Services.obs.addObserver(stateObserver, "social-service-manifest-changed", false);

  if (registry().enabled) {
    // we will have missed the -enabled notification...
    stateObserver.observe(null, 'social-browsing-enabled');
  }
  // if we are disabled so there is nothing to do - our "stateWidget"
  // will notice when we become enabled and bootstrap everything else.
  dump("social startup done on a window - state is " + registry().enabled + "\n");
}

function social_unload() {
  try {
  Services.obs.removeObserver(stateObserver, "social-browsing-enabled", false);
  } catch(e) { Cu.reportError(e); }
  try {
  Services.obs.removeObserver(stateObserver, "social-browsing-disabled", false);
  } catch(e) { Cu.reportError(e); }
  try {
  Services.obs.removeObserver(stateObserver, "social-service-manifest-changed", false);
  } catch(e) { Cu.reportError(e); }
  delete window.social;
}

// support for OverlayManager
var OverlayListener = {
  unload: social_unload
}

function social_main() {
  // due to what we are doing in the sidebar, we have to wait for the
  // chromeWindow to load before we do our magic
  Services.obs.addObserver({
    observe: function(aSubject, aTopic, aData) {
      Services.obs.removeObserver(this, "social-service-ready", false);
      // this will only happen if the registry is initialized after load,
      // which typically will only happen if the addon is enabled after
      // startup
      if (document.readyState == "complete") {
        social_init();
      }
  }}, "social-service-ready", false);
  window.addEventListener('load', function loadHandler(e) {
    window.removeEventListener('load', loadHandler);
    // ensure that the registry is ready to do stuff, if not
    // then the observer above will handle the init
    if (registry().ready) {
      social_init();
    }
  });
  // initialize the registry - we should be able to drop this explicit
  // initialization once we move to landing provider as part of the "core"
  initialize(function(manifest) {return new SocialProvider(manifest);});

  window.addEventListener('unload', function loadHandler(e) {
    window.removeEventListener('unload', loadHandler);
    social_unload();
  });
}

social_main();

dump("social_main is loaded\n");
