{
  baseUrl: '../js/ext',
  out: '../../../build_stage/email/js/ext/worker-bootstrap.js',
  mainConfigFile: '../js/ext/worker-config.js',

  // The kick-off is stripped out from the source worker-bootstrap by a pragma,
  // because we want this to be at the end of the file, just for cleanliness,
  // after all the defines are done.
  wrap: {
    end: '\nrequire([\'worker-setup\']);'
  },

  // There is enough cross reference of shared dependencies that we risk
  // loading duplicates for any other layers so just optimizing the initial one
  // used at worker startup. We are making a tradeoff between memory vs initial
  // load time. Since the email front end can start up without the full load of
  // the rest of the code in the worker favor saving memory.
  name: 'worker-bootstrap',
  include: [
    'alameda',
    'worker-config',
    'worker-setup',

    // Searches can happen offline.
    'searchfilter',

    // Job/operations are currently not gated, although they could be...
    'jobmixins',
    'jobs/outbox',
    'drafts/jobs',

    // Common account logic is required for everything.
    'accountmixins',

    // Include the chews because they are common and small-ish.
    'htmlchew',
    'quotechew',
    'mailchew',

    // main-frame-setup also wants this, so will delete it after the main gaia
    // app optimization runs, so include it now. Commonly needed at some point
    // during startup anyway.
    'addressparser'
  ],

  // This is now passed via Makefile's GAIA_EMAIL_MINIFY
  // but default is uglify2 if not passed at all.
  // optimize: 'none',

  // Just strip comments, no code compression or mangling.
  // Only active if optimize: 'uglify2'
  uglify2: {
    // Comment out the output section to get rid of line
    // returns and tabs spacing.
    output: {
      beautify: true
    }
  }
}
