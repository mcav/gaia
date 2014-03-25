requirejs.config({
  // Set waitSeconds to a high value. Under high memory pressure on
  // low-memory devices, it may take a long time for the modules to
  // load. For instance, when an alarm rings, we don't want to time
  // out trying to bring up the notification screen, even if it takes
  // a minute or two to load the clock app (because they're editing a
  // photo or some other high-memory activity). In production, modules
  // aren't going to disappear, so it makes sense to set an
  // arbitrarily high value here.
  waitSeconds: 180,
  paths: {
    shared: '../shared'
  },
  shim: {
    'shared/js/template': {
      exports: 'Template'
    },
    emitter: {
      exports: 'Emitter'
    },
    'shared/js/gesture_detector': {
      exports: 'GestureDetector'
    },
    'shared/js/async_storage': {
      exports: 'asyncStorage'
    },
    'shared/js/l10n_date': ['shared/js/l10n']
  }
});
