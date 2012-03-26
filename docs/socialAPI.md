Browser Social API Reference
============================

## Contents

1. Terms
2. Creation and Lifecycle of a Social Service Worker
3. Service Worker API Reference
    1. Methods available to Service Workers
    2. Messages Sent By Service Workers
    3. Messages Sent To Service Workers
4. Service Content API Reference
    1. Methods
5. Widgets
    1. SidebarWidget
        1. Messages Sent To Widget
        2. Browser Visual Integration
        3. Browser Panel Integration
    2. ShareWidget
        1. Messages Sent To Widget
6. Service Windows
7. Message Serialization
8. Example Interactions

# Terms

**Social Service Provider:**

A web service that provides one or more APIs to a browser to enable social features. It is defined to the browser by a structured text file, which instructs the browser how to load JavaScript and HTML resources that brings its functions into the browser.

**Service Worker:**
A long-running JS computation environment, managed by the browser, served by a user-specified web address, which acts as a coordination and communication hub for integration between the browser and a web service.

**Widget:**
A user-interface element, created by the browser, which provides a visual region for the display of content produced by the Service Provider.

**Service Message:**
A message is a JSON-encoded string that is either sent by the browser to the Service Worker, or sent by the Service Worker to the browser. These messages are used to coordinate the display of browser-managed user interface elements and to respond to user and content interactions. See Message Serialization for encoding details.

**Sidebar:**
A vertical rectangle of screen space, positioned to the side of normal browser content in a tabbed browser window, which is stable across brower navigation and tab-focus changes. A Sidebar may be minimized, which causes it to be rendered entirely in "above-the-content/not-overlaid-over-content" layout space.

**Recommend:**
The user-initiated act of indicating that a piece of web content (typically a URL) should be marked as being of interest to a user. No input other than than the URL is expected. A Recommend can be completed with no Widget; it has no user interface other than the button, menu bar, or command that indicates "recommend this".

**Share:**
The user-initiated act of sending a piece of web content (typically a URL) with an optional comment, explanation, or other data, to a user address, list of user addresses, social network, or other destination. The details of a Share interaction are service-specific and a ShareWidget is required to render the user interface to complete a share.

**Client-to-User Notification:**
Client-to-User Notification is the API that is made available to a Service Worker to indicate that data and interactions are pending for the user on this particular device, and that the service is ready to provide them. Subject to the browser's configuration, these notifications may be used to trigger a variety of attention-getting interface elements, including "toast" or "Growl"-style ephemeral windows, ambient notifications (e.g. glowing, hopping, pulsing), or collections (e.g. pull-down notification panels, lists of pending events). These Notifications are constructed to allow the Service Worker to receive notification when the user indicates interest in one of them, allowing the data presentation or interaction to proceed immediately.

**Server-to-Client Notification:**
Server-to-Client Notification is a system by which a service arranges for notifications to be delivered promptly and efficiently to a client. It is not a feature of this proposal, though existing web techniques including WebSockets, Server-Sent Events, XMLHttpRequest with long polling (or infrequently quick polling) can all be used from Service Workers. It is expected that a Service Worker that has received a Server-to-Client Notification will often relay this data into a Client-to-User Notification.

**Panel:**
A user-interface region (typically rectangular) that is temporarily displayed above content and browser chrome, used for short-lived interactions that are user-initiated or very important.

Creation and Lifecycle of a Social Service Worker
=================================================

It is expected that a Social Service Provider will be defined by a structured text file (JSON) containing a number of keyed URLs, a name, an icon, and a "root domain" prefix.

A Service Worker is instantiated with the Servicer Worker URL provided by the service provider, which should resolve to a JavaScript file that will be evaluated by the Server Worker. The Worker is a Shared Worker, rendered "headlessly", as per the Shared Web Workers specification.

The Service Worker lives until terminated, either by browser shutdown or by an explicit control command from the user.

If the browser determines that termination of the Service Worker is necessary, all of the service-level content associated with the Service Worker will be unloaded (i.e. all ServiceWindows and sidebars will be closed) as part of the termination.

If the browser starts (or restarts) the service during a normal user session, the Service Worker will be fully loaded first, and sidebars will then be instantiated on existing windows. ServiceWindows (e.g. chats) are not restarted automatically.

Service Worker Reference
========================

A Service Worker inherits all the limitations and behaviors available to HTML5 Shared Workers. It can create XMLHttpRequests, use WebSockets, receive messages from windows and the browser, use IndexedDB, and post messages to other windows.

The Worker can use the `ononline`, `onoffline`, and `navigator.online` methods and properties that are available to all Workers to obtain notification of the browser's online/offline status.

In addition to the standard methods, Service Workers have access these to these methods and events:

Methods available to Service Workers
------------------------------------
`navigator.mozNotification.createNotification`

Creates a Notification object. By constructing and showing a Notification, the Worker requests that the browser notify the user of an immediately-relevant change in state. See https://developer.mozilla.org/en/DOM/navigator.mozNotification for more detail. The Worker may attach an `onclick` or `onclose` handler to the notification, if desired.

NOTE: We want to augment the mozNotification object defined in the docs with an additional "type" field. Details TBD.

Messages Sent by Service Workers
---------------------------------
### `observe-isidle`
By constructing and posting an observe-isidle message, the Worker requests notification when the user has become idle.

* For more see https://wiki.mozilla.org/WebAPI/IdleAPI

### `user-recommend-prompt-response`

The Worker constructs and posts a user-recommend-prompt-response in response to a user-recommend-prompt message received from the browser.

*Arguments:*

**url**
> String. Must be set to the URL that was included in the user-recommend-prompt that causes this response, if any. This allows the browser to catch race conditions (i.e. when the user has navigated away from content before the service responded).

**img**
> String. Will be set as the "src" property of an image contained in the user-facing click target for the "recommend" action. It can contain a web-addressible image or a data URL containing dynamically-generated image data. Implementors are strongly encouraged to use a data URL to minimize latency.

Note that for some configurations, the browser will never provide a domain or url property in the user-recommend-prompt event; the Worker should be prepared to serve up static (e.g. data URL) content in these cases. (TODO: do we want to come up with a system to signal that it hasn't changed to speed up rendering?)

Messages Sent To Service Workers
--------------------------------
### `user-recommend-prompt`

Sent by the browser to request the visual prompt for the "user recommendation" interface element. The user agent MAY include a "url" or "domain" property with the request, indicating the current browsing context. The Worker should respond with a user-recommend-prompt-response

Note that most user agents will NOT include the domain and url in user-recommend-prompt, but that the user may, in some configurations, choose to enable URL- or domain-keyed prompting.

*Arguments:*

**domain**
> String, optional. If present, indicates the domain (scheme, host, and port) of the root of the current browser viewing context.

**url**
> String, optional. If present, indicates the full URL, including query string, but minus any hash text, of the root of the current browser viewing context.

###  `user-recommend`

Indicates that the user has clicked the "user recommendation" interface element. The message includes:

*Arguments:*

**url**
> String, required. The URL that the user is viewing, including query string, but minus any hash text, of the root of the current browser viewing context.

No response is necessary; however, the service may respond with a user-recommend-prompt-response if the click target should change its appearance.

### `user-isidle`

Sent by the browser when the idle timer requested in an earlier observe-isidle is reached.  No arguments.

### `user-endidle`

Sent by the browser when user activity resumes; only sent when a previous user-isidle has been sent.  No arguments.

Service Content API Reference
=============================

These methods are available to all Widget and ServiceWindow content.

TODO: Can Widget and ServiceWindow content send and receive the same messages as the Service Worker, or does that complicate things?

Methods:
--------
### `navigator.mozSocial.getWorker()`

returns a reference to the Service Worker. 

The content can then call postMessage on it as normal.

### `openServiceWindow( url, name, options, title, readyCallback)`
NOTE The openServiceWindow call is likely to change.

Creates a new window, initially displaying the `url` page.  This window will not have navigation controls or toolbars.  An attempt to create a "service window" with a domain that does not match the domain of the Service Provider is an error and will have no effect.

"service windows" will contain a single content region, with no tabbed browser elements, and no navigation chrome. The browser will display domain and security badges as its implementors see fit. The browser may implement "pinning" to attach the content region to an existing chrome window; content should observe the size of its window and reflow as needed.

Messages may be posted to and from the service window as normal. If the "name" argument passed to the function matches an existing window that is already open, a reference to that window is returned rather than opening a new one.

Calls to `openServiceWindow` are subject to normal anti-popup behavior: windows may only be opened in the event context of a user click. `window.onunload` is available as normal; implementors are encouraged to use it to notify the service that a window is closing.

Widgets
=======

SidebarWidget
-------------

If a service defines a SidebarWidget, the browser will instantiate a content region with the SidebarWidget URL as the location on some browser windows. These regions will not be instantiated until the Worker has been fully loaded. The content in these regions has the additional API defined in the Service Content API reference, above.

Sidebars can be in a *maximized*, *minimized*, or *hidden* state.

* When maximized, they will receive a vertical rectangle of screen space in which to render; this rectangle is stable across changes in tab focus and has an independent scrollbar from the scrollbar of tabbed browsing content.
* When minimized, they will receive a horizontal rectangle of screen space to the right of the (tab bar / navigation bar/ TBD) in which to render a small visual element. Service providers are encouraged to use this space for ambient notification and current-login-status.
* When hidden, a sidebar is completely removed from the visual hierarchy. The user agent will continue to deliver messages to it, and the sidebar may pre-render its DOM for later display. (TODO: Is this right? Or should we "suspend" when we minimize? If we do, it becomes harder to dynamically display sidebar later; maybe this isn't a problem) 

Sidebar windows will only be instantiated on browser windows that have a full tabbed-browsing interface; windows created with window.open that do not have these interface elements will not have a sidebar.

The minimized/maximized/hidden state of the sidebar widget is a per-window setting. The most-recently-set state is remembered and used for new windows, and is persisted across browser restarts.

Messages Sent to Widget
-----------------------

### `content-hidden`

Sent by the browser when the user hides the sidebar content.

### `content-minimized`

Sent by the browser when the user minimizes the sidebar content.

TODO: does this fire when the user initiates the minimize or after animation? if the former, maybe provide a way to read out the expected height when minimized?

### `content-maximized`

Sent by the browser when the user maximizes the sidebar content.

Browser Visual Integration
--------------------------

To allow remote content to integrate smoothly with browser chrome, the following CSS classes are automatically introduced to sidebar content:

### `mozSidebarMinimizedHeight:`
> Sets "height:<int>px", with the height of the visual region that is available to sidebar content when it has been minimized.

TODO: Perhaps this should be a message instead?

Browser "Panel" Integration
---------------------------

To allow content to place an ephemeral window in front of normal browser content and chrome, the following API is used:

    TODO

ShareWidget
===========

If a service defines a ShareWidget, when the user triggers the "Share" behavior, the browser will create a "floating panel" interface element containing an IFRAME whose src is set to the ShareWidget URL. A Share event is then fired at the message, as defined in the ShareHandler section, below.

The service provider may perform content interactions in this IFRAME to prompt the user for details about the share, and may use XMLHttpRequest or window-level navigation to change the content.

The service provider should call `window.close` when the interaction with the share panel is complete. Alternatively, the user may click away from the panel, causing the window to be closed immediately.

Messages Sent to Widget:
------------------------
### `begin-share`

Sent by the browser to the share widget once the widget has loaded, providing the details of the content the user has requested to share.

**Arguments TBD**


ServiceWindows
==============

ServiceWindows are created by calling `openServiceWindow` in a Widget window.

A ServiceWindow can only serve content from the Social Service Provider's domain. Any attempt to navigate the root of the ServiceWindow's browser away from this domain will be automatically intercepted and redirected to a new tab in the front most tabbed browsing window (or a new window if no such browsing window exists).

ServiceWindow content inherits the API defined for ServiceContent above.

TODO On OSes that require an application window to be open for process visibility, does closing all the tabbed browsing windows and keeping a ServiceWindow open cause application shutdown, or does the browser keep running? If it keeps running we need a way to get a browser window back.

TODO: Need to specify more about the primary widget interactions of ServiceWindows. On Windows they get an application menu, on Mac they need to inherit some of the MenuBar (rather like prefwindows).

ServiceWindows are expected to use `getWorker()` and `postMessage()` to register with the Service Worker shortly after becoming loaded. The Service Worker can inspect the "origin" property of messages that are delivered this way to make a list of current windows, and can invoke the `close()` and `focus()` methods on these windows.

TODO: can the service see the "frontmost/hasfocus" property on these windows?

`window.onunload` is available as normal; implementors are encouraged to use it to notify the service that they are going away. The Service Worker can also inspect the .closed property of postMessage origins to see if the window has been closed.

Changes to `document.title` in the service window's content will change the title displayed on the window, in operating systems where that concept is applicable.


Message Serialization
=====================

For a message with topic `topic` and arguments (arg1:val1, arg2:val2), construct an object like:
    
    { topic: topic, arg1: val1, arg2: val2 }

Example interactions / expected implementation flow
===================================================

* The service is registered with a Service, Sidebar widget, and Share widget
* At browser startup time, the Service Worker is instantiated.
* The service opens a connection its service, if a user session is available, and starts receiving push events.
* When a browser window is created, the Sidebar widget content is instantiated.
* The sidebar registers with the service by using mozSocial.getWorker().postMessage("hello")
* The service worker catches the "hello" message and adds the sidebarContentWindow to a list of event sinks.
* The sidebar content may then perform more elaborate publish-subscribe handshaking, to limit what events it receives.
* When the service receives events from the server (or from other content), it invokes postMessage on each window reference that was previously saved. The sidebar redraws as needed.
* If the user clicks in the sidebar to e.g. open a chat window, window.open is invoked and a new window is created. The chat window registers with the service by using mozSocial.getWorker().postMessage("hello") and receives a message back telling it who to open a chat with. The service might then deliver server-pushed events to the chat window, perhaps through a publish-subscribe system. 

To Figure Out
=============

1. Should we not create a sidebar window if the user isn't signed in? Or should we create a sidebar that can present a "sign in" box?
2. Do we need to blacklist some URLs for "recommend"? (i.e. anything with security-sensitive GET params)
3. Can sidebar content cause itself to be hidden, minimized, maximized?
4. Can serviceWindows cause themselves to be hidden, minimized, maximized, resized?
5. Still need to figure out panels popping out of sidebar, especially in minimized mode; position, sizing, asynchrony.
6. Punting on any questions of content-talking-to-service right now, or vice-versa. Two worlds for now. Preference is for markup. 

