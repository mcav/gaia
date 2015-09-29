/* global Card, TaskManagerUtils, LazyLoader, Service, StackManager,
          eventSafety, SettingsListener, AppWindow, BrowserConfigHelper */
'use strict';

(function(exports) {

/**
 * The TaskManager shows running windows as a list of cards.
 *
 * When TaskManager is shown, it grabs a copy of StackManager's stack of apps,
 * and instantiates one Card for each AppWindow in the stack.
 *
 * State Management
 * ----------------
 *
 * State updates are handled, waterfall-style, with the following functions:
 *
 * - updateStack()
 *     '- updateLayout()
 *          '- updateScrollPosition()
 *
 * For instance, when the stack changes, we must perform layout; when layout
 * changes, we must update our scroll position. Each function calls the
 * dependent functions itself, to make state updates easy. Simply call the
 * appropriate function corresponding to the highest-level changes needed,
 * and we'll update the appropriate dependent state accordingly:
 *
 * - Call updateStack() when StackManager's stack has changed.
 * - Call updateLayout() when window dimensions change.
 * - Call updateScrollPosition() when the scroll position has changed.
 */
function TaskManager() {
  this.appToCardMap = new Map(); // AppWindow -> Card
  this.elementToCardMap = new Map(); // <div.card> -> Card
  this.stack = []; // a copy of StackManager's stack of AppWindow instances
  this.currentCard = null;
  this._active = false;
  this.disableScreenshots = false;
}

TaskManager.prototype = {
  CARD_GUTTER: 25, // (horizontal margin between cards, in pixels)
  name: 'TaskManager', // (needed by HierarchyManager)
  USE_SCREENSHOTS_SETTING: 'app.cards_view.screenshots.enabled',

  /**
   * Start the TaskManager module; this occurs once on startup.
   *
   * @return {Promise}
   */
  start() {
    this.element = document.getElementById('task-manager'),
    this.scrollElement = document.getElementById('cards-view'),
    this.cardsList = document.getElementById('cards-list');
    this.screenElement = document.getElementById('screen');
    this.noRecentWindowsEl = document.getElementById('cards-no-recent-windows');
    this.newSheetButton =
      document.getElementById('task-manager-new-sheet-button');
    this.newPrivateSheetButton =
      document.getElementById('task-manager-new-private-sheet-button');

    window.addEventListener('taskmanagershow', this);
    Service.request('registerHierarchy', this);

    // Listen for changes to the "show screenshots" preference.
    this.setScreenshotSetting = this.setScreenshotSetting.bind(this);
    SettingsListener.observe(
      this.USE_SCREENSHOTS_SETTING,
      !this.disableScreenshots,
      this.setScreenshotSetting);

    return LazyLoader.load([
      'js/card.js',
      'js/task_manager_utils.js'
    ]);
  },

  /**
   * Stop the TaskManager module.
   *
   * @return {Promise}
   */
  stop() {
    window.removeEventListener('taskmanagershow', this);
    Service.request('unregisterHierarchy', this);

    SettingsListener.unobserve(
      this.USE_SCREENSHOTS_SETTING, this.setScreenshotSetting);
  },

  /**
   * Update the USE_SCREENSHOTS_SETTING value. See `Card` for more details.
   */
  setScreenshotSetting(useScreenshots) {
    this.disableScreenshots = !useScreenshots;
  },

  /**
   * Create a new Card representing the given app, and add it to the DOM.
   * (This does not deal with stack order.)
   */
  _addApp(app) {
    var card = new Card(app, this.disableScreenshots);
    this.cardsList.appendChild(card.element);
    this.elementToCardMap.set(card.element, card);
    this.appToCardMap.set(app, card);
    return card;
  },

  /**
   * Remove the card representing `app` from the DOM. This only occurs in
   * direct response to stack changes or when the task manager is hidden.
   */
  _removeApp(app) {
    var card = this.appToCardMap.get(app);
    if (card) {
      this.appToCardMap.delete(app);
      this.elementToCardMap.delete(card.element);
      this.cardsList.removeChild(card.element);
    }
  },

  /**
   * Update our stack and list of cards to match StackManager.
   * Call this whenever we think the stack has changed; this function will
   * take care of updating the layout and card positions.
   */
  updateStack() {
    this.stack = StackManager.snapshot();

    if (this._browserOnly) {
      this.stack = this.stack.filter((app) => {
        return app.isBrowser() ||
          (app.manifest && app.manifest.role === 'search');
      });
    }

    navigator.mozL10n.setAttributes(this.noRecentWindowsEl,
      this._browserOnly ?
        'no-recent-browser-windows' : 'no-recent-app-windows');
    this.element.classList.toggle('filtered', !!this._browserOnly);

    var latestAppSet = new Set(this.stack);

    this.appToCardMap.forEach((card, app) => {
      if (!latestAppSet.has(app)) {
        this._removeApp(app);
      }
    });

    this.stack.forEach((app) => {
      var card = this.appToCardMap.get(app);
      if (!card) {
        card = this._addApp(app);
        app.enterTaskManager();
      }
    });

    this.updateLayout();
  },

  /**
   * Update the card positions and layout.
   * Called in response to window resize and stack changes.
   */
  updateLayout() {
    this.cardWidth = window.innerWidth / 2;
    this.cardHeight = window.innerHeight / 2;

    var count = this.stack.length;
    var margins = window.innerWidth - this.cardWidth;
    var cardStripWidth = this.cardWidth * count +
                         this.CARD_GUTTER * (count - 1);
    var contentWidth = margins + Math.max(this.cardWidth, cardStripWidth);

    this.stack.forEach((app, index) => {
      var card = this.appToCardMap.get(app);
      var offset = (this.cardWidth + this.CARD_GUTTER);
      var left = (margins / 2) + (offset * index);

      card.translate({ x: left + 'px' });
    });

    this.cardsList.style.width = contentWidth + 'px';

    this.updateScrollPosition();
  },

  /**
   * Update our bookkeeping for when the scroll position changes, used
   * primarily for updating cards' accessibility attributes.
   */
  updateScrollPosition() {
    var index = this.getCurrentIndex();
    var currentCard = this.appToCardMap.get(this.stack[index]);

    if (this.currentCard !== currentCard) {
      this.currentCard = currentCard;

      this.stack.forEach((app, idx) => {
        var card = this.appToCardMap.get(app);
        // Hide non-current apps from the screen reader.
        card.element.setAttribute('aria-hidden', card !== currentCard);
        // Update the screen reader card list size.
        card.element.setAttribute('aria-setsize', this.stack.length);
        // Update the screen reader card index.
        card.element.setAttribute('aria-posinset', idx + 1);
      });
    }
  },

  /**
   * Return the current index into `this.stack`, taking current scroll position
   * into account. (Extracted for unit test purposes.)
   */
  getCurrentIndex() {
    return Math.min(
      this.stack.length - 1,
      Math.floor(this.scrollElement.scrollLeft / this.cardWidth));
  },

  /**
   * Show the Task Manager if it is not already visible.
   *
   * @param {boolean} opts.browserOnly
   *   If true, only include browser apps. (Legacy feature)
   */
  show(opts) {
    if (this.isShown() || this._isTransitioning) {
      return Promise.resolve();
    }

    // To prevent race conditions when opening or closing (since both opening
    // and closing are asynchronous), set this._isTransitioning when we're
    // either showing or hiding. The flag is cleared during this.setActive().
    this._isTransitioning = true;


    this._browserOnly = opts && opts.browserOnly;

    this.publish('cardviewbeforeshow'); // Will hide the keyboard if needed

    // Wait for the screen to rotate into portrait orientation,
    // and for the keyboard to dismiss completely, if applicable.
    return TaskManagerUtils.waitForScreenToBeReady().then(() => {
      window.addEventListener('lockscreen-appopened', this);
      window.addEventListener('attentionopened', this);
      window.addEventListener('appopen', this);
      window.addEventListener('appterminated', this);
      window.addEventListener('wheel', this);
      window.addEventListener('resize', this);
      this.element.addEventListener('click', this);
      this.element.addEventListener('card-will-drag', this);
      this.element.addEventListener('card-dropped', this);
      this.scrollElement.addEventListener('scroll', this);

      this.updateStack();
      this.panToApp(StackManager.getCurrent(), true);
      this.setActive(true);

      var activeApp = Service.query('AppWindowManager.getActiveWindow');
      if (activeApp && activeApp.isHomescreen) {
        activeApp.close('home-to-cardview');
        this.element.classList.add('from-home');
      }

      // Wait for the current app to signal that it has closed in preparation
      // for showing the task manager before cleaning things up.
      return TaskManagerUtils.waitForAppToClose(activeApp);
    }).then(() => {
      this.publish('cardviewshown');
      this.screenElement.classList.add('cards-view');
      this.element.classList.remove('from-home');
    });
  },

  /**
   * Hide the Task Manager and return to the AppWindow specified, or the
   * homescreen otherwise.
   */
  hide(newApp, animation) {
    if (!this.isShown() || this._isTransitioning) {
      return Promise.resolve();
    }

    this._isTransitioning = true;

    window.removeEventListener('lockscreen-appopened', this);
    window.removeEventListener('attentionopened', this);
    window.removeEventListener('appopen', this);
    window.removeEventListener('appterminated', this);
    window.removeEventListener('wheel', this);
    window.removeEventListener('resize', this);
    this.element.removeEventListener('click', this);
    this.element.removeEventListener('card-will-drag', this);
    this.element.removeEventListener('card-dropped', this);
    this.scrollElement.removeEventListener('scroll', this);

    newApp = newApp ||
      Service.query('AppWindowManager.getActiveWindow') ||
      Service.query('getHomescreen', true);

    // Other apps observe 'cardviewclosed' to note that we've potentially
    // changed stack positions.
    var latestStack = StackManager.snapshot();
    var detail = {};
    var newStackPosition = newApp ? latestStack.indexOf(newApp) : -1;
    if (newStackPosition !== -1) {
      detail.newStackPosition = newStackPosition;
    }

    // Remove '.cards-view' now, so that the incoming app animation begins its
    // transition at the proper scale.
    this.screenElement.classList.remove('cards-view');
    this.publish('cardviewclosed', { detail });

    // Set the proper transition...
    if (newApp.isHomescreen) {
      this.element.classList.add('to-home');
      newApp.open('home-from-cardview');
    } else {
      newApp.open(animation || 'from-cardview');
    }

    // ... and when the transition has finished, clean up.
    return eventSafety(newApp.element, '_opened', () => {
      this.setActive(false);
      this.element.classList.remove('to-home');
      this.element.classList.remove('filtered');
      this.stack.forEach((app) => {
        this._removeApp(app);
        app.leaveTaskManager();
      });
    }, 1000);
  },

  /**
   * Perform a user-initiated action on the given card.
   */
  cardAction(card, actionName) {
    switch (actionName) {
      case 'close':
        var index = this.stack.indexOf(card.app);
        // If this is the last card on the stack, we must scroll to the left
        // before killing the app; otherwise we can stay where we are.
        if (this.stack.length > 1 && index === this.stack.length - 1) {
          this.panToApp(this.stack[this.stack.length - 2]).then(() => {
            card.app.kill();
          });
        } else {
          card.app.kill();
        }
        break;

      case 'favorite' :
        console.log('cardAction: TODO: favorite ' +
                    card.element.dataset.origin);
        break;

      case 'select':
        this.panToApp(card.app).then(() => {
          this.hide(card.app);
        });
        break;
    }
  },

  /**
   * Scroll smoothly to the given app.
   *
   * @param {AppWindow} app
   *   If this window is not found, we'll scroll to the most-recent app.
   * @param {boolean} [immediately]
   *   If true, scroll without animation.
   */
  panToApp(app, immediately) {
    // TODO: better way to know we've arrived at the target card
    // and make the delay proportional to the distance panned
    // See: bug 1172171
    var idx = this.stack.indexOf(app);
    if (idx === -1) {
      idx = this.stack.length - 1;
    }
    var currentPosition = this.scrollElement.scrollLeft;
    var desiredPosition = (this.cardWidth + this.CARD_GUTTER) * idx;
    return new Promise((resolve, reject) => {
      if (currentPosition === desiredPosition) {
        resolve();
      } else {
        this.scrollElement.scrollTo({
          left: desiredPosition,
          top: 0,
          behavior: immediately ? 'auto' : 'smooth'
        });
        setTimeout(resolve, 200);
      }
    });
  },

  handleEvent(evt) {
    var card;

    switch (evt.type) {
      case 'click':
        if (evt.target === this.newSheetButton) {
          this.openNewSheet({ isPrivate: false });
        } else if (evt.target === this.newPrivateSheetButton) {
          this.openNewSheet({ isPrivate: true });
        } else if (this.element.classList.contains('empty')) {
          this.hide(Service.query('getHomescreen', true));
        } else {
          card = this.elementToCardMap.get(evt.target.closest('.card'));
          if (card) {
            this.cardAction(card, evt.target.dataset.buttonAction || 'select');
          }
        }
        break;

      case 'resize':
        this.updateLayout();
        break;

      case 'scroll':
        if (this.scrollElement.style.overflowX === 'hidden') {
          // Believe it or not, you will receive scroll events even when
          // overflow is hidden. We don't care about those, because we're
          // dragging a card; the user won't see scroll events.
        } else {
          this._lastScrollTimestamp = Date.now();
        }
        this.updateScrollPosition();
        break;

      case 'card-will-drag':
        // To provide an axis-lock effect, we track the time of the last scroll
        // event. If the list has scrolled after the user touched the screen,
        // we must prevent the drag from resulting in a swipe-up.
        if (evt.detail.firstTouchTimestamp < (this._lastScrollTimestamp || 0)) {
          evt.preventDefault();
        }
        // If we're not going to prevent the drag, we should disable scrolling
        // while the card is dragging; we'll reenable it on "card-dropped".
        else {
          this.scrollElement.style.overflowX = 'hidden';
        }
        break;

      case 'card-dropped':
        // The user has stopped touching the card; it will either bounce back
        // into position, or we'll need to kill the app if they swiped upward.
        // Regardless, reenable scrolling:
        this.scrollElement.style.overflowX = 'scroll';
        // And kill the app after the swipe-up transition has finished.
        if (evt.detail.willKill) {
          card = this.elementToCardMap.get(evt.target);
          // Give the fling-up animation time to finish.
          eventSafety(card.element, 'transitionend', () => {
            this.cardAction(card, 'close');
          }, 400);
        }
        break;

      case 'wheel':
        // Screen readers send a 'wheel' event for a two-finger swipe up.
        // Kill the current app if the user so desires.
        if (evt.deltaMode === evt.DOM_DELTA_PAGE && this.currentCard) {
          var currentIndex = this.stack.indexOf(this.currentCard.app);
          if (evt.deltaY > 0 && this.currentCard.app.killable()) {
            this.currentCard.app.kill();
          } else if (evt.deltaX < 0 && currentIndex >= 1) {
            this.panToApp(this.stack[currentIndex - 1]);
          } else if (evt.deltaX > 0 && currentIndex < this.stack.length - 1) {
            this.panToApp(this.stack[currentIndex + 1]);
          }
        }
        this.updateScrollPosition();
        break;

      case 'lockscreen-appopened':
      case 'attentionopened':
      case 'appopen':
        this.hide();
        break;

      case 'taskmanagershow':
        this.show({
          browserOnly: evt.detail && evt.detail.filter === 'browser-only'
        });
        break;

      case 'appterminated':
        this.updateStack();
        if (this.stack.length === 0) {
          this.hide();
        }
        break;
    }
  },

  // Lifecycle Methods

  respondToHierarchyEvent(evt) {
    if (!this._isTransitioning) {
      if (evt.type === 'home') {
        if (this.isShown()) {
          this.hide(Service.query('getHomescreen', true));
          return false; // stop the event
        }
      } else if (evt.type === 'holdhome') {
        if (!this.isShown()) {
          this.show();
          return false; // stop the event
        }
      }
    }
    return true; // keep the event flowing
  },

  publish(type, detail) {
    var event = new CustomEvent(type, detail || null);
    window.dispatchEvent(event);
  },

  setFocus() {
    return true;
  },

  isShown() {
    return this.isActive();
  },

  isActive() {
    return this._active;
  },

  setActive(active) {
    if (this._active === active) {
      return;
    }

    this._isTransitioning = false; // Done opening or closing.
    this._active = active;
    if (active) {
      this.publish('taskmanager-activated');
    } else {
      this.publish('taskmanager-deactivated');
    }
    this.element.classList.toggle('active', active);
    this.element.classList.toggle('empty', active && this.stack.length === 0);
  },

  openNewSheet({ isPrivate } = {}) {
      var appWindow;

    if (isPrivate) {
      appWindow = new AppWindow(new BrowserConfigHelper({
        manifestURL: 'app://search.gaiamobile.org/manifest.webapp',
        url: 'app://search.gaiamobile.org/newtab.html?private=1',
        isPrivate: true,
        isMockPrivate: true,
        oop: true
      }));
    } else {
      appWindow = new AppWindow(new BrowserConfigHelper({
        manifestURL: 'app://search.gaiamobile.org/manifest.webapp',
        url: 'app://search.gaiamobile.org/newtab.html'
      }));
    }

    this.element.classList.remove('empty');

    this.updateStack();
    var card = this.appToCardMap.get(appWindow);
    card.element.style.display = 'none';

    // NOTE: simultaneous
    this.panToApp(appWindow);
    this.hide(appWindow, 'from-new-card');
  }

};

exports.TaskManager = TaskManager;

})(window);
