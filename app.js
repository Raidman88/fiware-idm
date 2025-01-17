const body_parser = require('body-parser');
const useragent = require('express-useragent');
const clc = require('cli-color');
const cookie_parser = require('cookie-parser');
const cors = require('cors');
const debug = require('debug')('idm:app');
const express = require('express');
const favicon = require('serve-favicon');
const force_ssl = require('express-force-ssl');
const i18n = require('i18n-express');
const logger = require('morgan');
const method_override = require('method-override');
const partials = require('express-partials');
const path = require('path');
const sass_middleware = require('./lib/node-sass-middleware');
const session = require('cookie-session');
const package_info = require('./package.json');
const fs = require('fs');

const version = require('./version.json');
version.keyrock.version = package_info.version;
version.keyrock.doc = package_info.homepage;

fs.stat('./package.json', function (err, stats) {
  version.keyrock.release_date = stats.mtime;
});

// Obtain secret from config file
const config_service = require('./lib/configService.js');
const config = config_service.get_config();

// Create vars that store routes
const index = require('./routes/web/index');
const api = require('./routes/api/index');
const oauth2 = require('./routes/oauth2/oauth2');
const saml2 = require('./routes/saml2/saml2');
const authregistry = require('./routes/authregistry/authregistry');
const oauth2_controller = require('./controllers/oauth2/oauth2');

const translation_merger = require('./lib/json_directory_merger');

const app = express();
const helmet = require('helmet');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Set logs in development
if (config.debug) {
  app.use(logger('dev'));
}
// img-src 'self' data:image/png
// Disabled header
app.disable('x-powered-by');
// Set security headers
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'", 'data:'], // eslint-disable-line snakecase/snakecase
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'], // eslint-disable-line snakecase/snakecase
      imgSrc: ["'self'", 'data'], // eslint-disable-line snakecase/snakecase
      scriptSrc: ["'self'", "'unsafe-inline'"], // eslint-disable-line snakecase/snakecase
      styleSrc: ["'self'", 'https:', "'unsafe-inline'", 'https://fonts.googleapis.com'] // eslint-disable-line snakecase/snakecase
    },
    reportOnly: false // eslint-disable-line snakecase/snakecase
  })
);
app.use(
  helmet.dnsPrefetchControl({
    allow: process.env.IDM_DNS_PREFETCH_ALLOW === 'true'
  })
);
app.use(helmet.expectCt());
app.use(
  helmet.frameguard({
    action: process.env.IDM_FRAMEGUARD_ACTION || 'sameorigin'
  })
);
app.use(
  helmet.hsts({
    maxAge: process.env.IDM_HTTPS_MAX_AGE || 15552000, // eslint-disable-line snakecase/snakecase
    includeSubDomains: process.env.IDM_INCLUDE_SUB_DOMAINS !== 'false', // eslint-disable-line snakecase/snakecase
    preload: process.env.IDM_PRELOAD === 'true'
  })
);
app.use(helmet.ieNoOpen());
app.use(helmet.noSniff());

// options.permittedPolicies is a string that must be "none",
//"master-only", "by-content-type", or "all". It defaults to "none".
app.use(
  helmet.permittedCrossDomainPolicies({
    permittedPolicies: process.env.IDM_PERMITTED_POLICIES || 'none' // eslint-disable-line snakecase/snakecase
  })
);
app.use(helmet.referrerPolicy());
app.use(helmet.xssFilter());

// Parse request
app.use(body_parser.json({ limit: '50mb' }));
app.use(body_parser.urlencoded({ limit: '50mb', extended: true }));

// Parse user agent header
app.use(useragent.express());

// CORS Enable
if (config.cors.enabled) {
  app.use(cors(config.cors.options));
}

// Set routes for version
const up_date = new Date();
app.use('/version', function (req, res) {
  version.keyrock.uptime = require('./lib/time').ms_to_time(new Date() - up_date);
  version.keyrock.api.link = config.host + '/' + version.keyrock.api.version;
  res.status(200).send(version);
});

// The following middlewares are used by the GUI only. Not required in headless mode.
if (!config.headless) {
  // uncomment after placing your favicon in /public
  app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
  app.use(partials());

  app.use(cookie_parser(config.session.secret));

  app.use(
    session({
      secret: config.session.secret,
      name: 'session',
      secure: config.https.enabled,
      maxAge: config.session.expires // eslint-disable-line snakecase/snakecase
    })
  );

  const styles = config.site.theme || 'default';
  // Middleware to convert sass files to css
  app.use(
    sass_middleware({
      src: path.join(__dirname, 'themes/' + styles),
      dest: path.join(__dirname, 'public/stylesheets'),
      debug: config.debug,
      outputStyle: 'compressed', // eslint-disable-line snakecase/snakecase
      prefix: '/stylesheets' // Where prefix is at <link rel="stylesheets" href="prefix/style.css"/>
    })
  );
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(method_override('_method'));

  const translation_path = path.join(__dirname, 'etc/translations/');
  app.use(
    translation_merger.init({
      directory_1: translation_path,
      directory_2: path.join(__dirname, 'themes/' + config.site.theme + '/translations/'),
      merged_path: path.join(__dirname, 'public/', 'translations_merged')
    }),
    i18n({
      translationsPath: translation_merger.get_merge_path(), // eslint-disable-line snakecase/snakecase
      siteLangs: ['de', 'en', 'es', 'ja', 'ko'], // eslint-disable-line snakecase/snakecase
      textsVarName: 'translation', // eslint-disable-line snakecase/snakecase
      browserEnable: true, // eslint-disable-line snakecase/snakecase
      defaultLang: config.lang.default_lang || 'en' // eslint-disable-line snakecase/snakecase
    })
  );

  // Helpers dinamicos:
  app.use(function (req, res, next) {
    res.set('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');

    // init req.session.redir
    if (!req.session.redir) {
      req.session.redir = '/';
    }

    // To make visible req.session in the view
    res.locals.session = req.session;

    // {text: 'message text', type: 'info | success | warning | danger'}
    res.locals.message = {};
    // {text: 'message text', status: ''}
    res.locals.error = {};

    res.locals.site = config.site;
    res.locals.fs = require('fs');

    next();
  });
}

// Force HTTPS connection to web server
if (config.https.enabled) {
  app.set('forceSSLOptions', {
    enable301Redirects: true, // eslint-disable-line snakecase/snakecase
    trustXFPHeader: false, // eslint-disable-line snakecase/snakecase
    httpsPort: config.https.port, // eslint-disable-line snakecase/snakecase
    sslRequiredMessage: 'SSL Required.' // eslint-disable-line snakecase/snakecase
  });

  // Set routes for api
  app.use('/v1', force_ssl, api);
  app.use('/v3', force_ssl, api); // REDIRECT OLD KEYSTONE REQUESTS TO THE SAME API

  // Set routes for oauth2
  app.use('/oauth2', force_ssl, oauth2);
  app.get('/user', force_ssl, oauth2_controller.authenticate_token);

  if (config.authorization.level === 'payload') {
    app.post('/pdp/open_policy_agent', force_ssl, oauth2_controller.auth_opa_policy);
    app.post('/pdp/xacml', force_ssl, oauth2_controller.auth_xacml_policy);
  }

  // Set routes for saml2
  app.use('/saml2', force_ssl, saml2);

  // Set routes for the authorization registry if enabled
  if (config.ar.url === 'internal') {
    app.use('/ar', authregistry);
  }

  if (!config.headless) {
    // The following routes are used by the GUI only. Not required in headless mode.
    app.use('/', force_ssl, index);
  } else {
    app.get('/', function (req, res) {
      res.status(501).json({
        error: 'Keyrock instance is running in HEADLESS mode'
      });
    });
  }
} else {
  // Set routes for api
  app.use('/v1', api);
  app.use('/v3', api); // REDIRECT OLD KEYSTONE REQUESTS TO THE SAME API

  // Set routes for oauth2
  app.use('/oauth2', oauth2);
  app.get('/user', oauth2_controller.authenticate_token);

  if (config.authorization.level === 'payload') {
    app.post('/pdp/open_policy_agent', oauth2_controller.auth_opa_policy);
    app.post('/pdp/xacml', oauth2_controller.auth_xacml_policy);
  }

  // Set routes for saml2
  app.use('/saml2', saml2);

  // Set routes for the authorization registry if enabled
  if (config.ar.url === 'internal') {
    app.use('/ar', authregistry);
  }

  if (!config.headless) {
    // The following routes are used by the GUI only. Not required in headless mode.
    app.use('/', index);
  } else {
    app.get('/', function (req, res) {
      res.status(501).json({
        error: 'Keyrock instance is running in HEADLESS mode'
      });
    });
  }
}

debug(
  clc.green(config.headless ? 'Keyrock instance is clustered and running in HEADLESS mode' : 'Keyrock GUI is available')
);

// Check connection with Authzforce
if (config.authorization.authzforce.enabled) {
  require('./lib/authzforce.js')
    .check_connection()
    .then(function (status) {
      debug(clc.green('Connection with Authzforce: ' + status));
    })
    .catch(function (error) {
      debug(clc.red(error));
    });
}

module.exports = app;
