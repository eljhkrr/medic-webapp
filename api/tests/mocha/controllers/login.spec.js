const controller = require('../../../src/controllers/login'),
      chai = require('chai'),
      environment = require('../../../src/environment'),
      auth = require('../../../src/auth'),
      db = require('../../../src/db').medic,
      sinon = require('sinon'),
      config = require('../../../src/config'),
      request = require('request-promise-native'),
      fs = require('fs'),
      DB_NAME = 'lg',
      DDOC_NAME = 'medic';

let req,
    res,
    originalEnvironment;

describe('login controller', () => {

  beforeEach(() => {
    req = {
      query: {},
      body: {},
      hostname: 'xx.app.medicmobile.org'
    };
    res = {
      redirect: () => {},
      send: () => {},
      status: () => {},
      json: () => {},
      cookie: () => {}
    };
    originalEnvironment = Object.assign(environment);

    environment.db = DB_NAME;
    environment.ddoc = DDOC_NAME;
    environment.protocol = 'http';
    environment.host = 'test.com';
    environment.port = 1234;
    environment.pathname = 'sesh';
  });

  afterEach(() => {
    environment.db = originalEnvironment.db;
    environment.ddoc = originalEnvironment.ddoc;
    environment.protocol = originalEnvironment.protocol;
    environment.host = originalEnvironment.host;
    environment.port = originalEnvironment.port;
    environment.pathname = originalEnvironment.pathname;

    sinon.restore();
  });

  describe('safePath', () => {

    [
      '',
      null,
      'http://example.com',
      '%22%3E%3Cscript%3Ealert%28%27hello%27%29%3C/script%3E',
      'https://app.medicmobile.org/wrong/path',
      'http://app.medicmobile.org/lg/_design/medic/_rewrite', // wrong protocol
      '/lg/_design/medic/_rewrite/../../../../../.htpasswd',
      '/lg/_design/medic/_rewrite_gone_bad',
    ].forEach(requested => {
      it(`Bad URL "${requested}" should redirect to root`, () => {
        chai.expect('/lg/_design/medic/_rewrite').to.equal(controller.safePath(requested));
      });
    });

    [
      '/lg/_design/medic/_rewrite',
      '/lg/_design/medic/_rewrite/',
      '/lg/_design/medic/_rewrite#fragment',
      '/lg/_design/medic/_rewrite#path/fragment',
      '/lg/_design/medic/_rewrite/long/path',
    ].forEach(requested => {
      it(`Good URL "${requested}" should redirect unchanged`, () => {
        chai.expect(requested).to.equal(controller.safePath(requested));
      });
    });

    [
      {
        given: 'http://test.com:1234/lg/_design/medic/_rewrite',
        expected: '/lg/_design/medic/_rewrite'
      },
      {
        given: 'http://test.com:1234/lg/_design/medic/_rewrite#fragment',
        expected: '/lg/_design/medic/_rewrite#fragment'
      },
      {
        given: 'http://wrong.com:666/lg/_design/medic/_rewrite#path/fragment',
        expected: '/lg/_design/medic/_rewrite#path/fragment'
      },
      {
        given: 'http://wrong.com:666/lg/_design/medic/_rewrite/long/path',
        expected: '/lg/_design/medic/_rewrite/long/path'
      },
    ].forEach(({ given, expected }) => {
      it(`Absolute URL "${given}" should redirect as a relative url`, () => {
        chai.expect(expected).to.equal(controller.safePath(given));
      });
    });

  });

  describe('get', () => {

    it('when already logged in redirect to app', () => {
      const getUserCtx = sinon.stub(auth, 'getUserCtx').resolves({ name: 'josh' });
      const redirect = sinon.stub(res, 'redirect');
      const cookie = sinon.stub(res, 'cookie').returns(res);
      return controller.get(req, res).then(() => {
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(getUserCtx.args[0][0]).to.deep.equal(req);
        chai.expect(cookie.callCount).to.equal(1);
        chai.expect(cookie.args[0][0]).to.equal('userCtx');
        chai.expect(cookie.args[0][1]).to.equal('{"name":"josh"}');
        chai.expect(redirect.callCount).to.equal(1);
        chai.expect(redirect.args[0][0]).to.equal('/lg/_design/medic/_rewrite');
      });
    });

    it('when not logged in send login page', () => {
      const getUserCtx = sinon.stub(auth, 'getUserCtx').rejects('not logged in');
      const getDoc = sinon.stub(db, 'get').resolves({
        _id: 'branding',
        resources: {
          logo: 'xyz'
        },
        _attachments: {
          xyz: {
            content_type: 'zes',
            data: 'xsd'
          }
        }
      });
      const send = sinon.stub(res, 'send');
      const readFile = sinon.stub(fs, 'readFile').callsArgWith(2, null, 'LOGIN PAGE GOES HERE. {{translations.login}}');
      sinon.stub(config, 'translate').returns('TRANSLATED VALUE.');
      return controller.get(req, res).then(() => {
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(getUserCtx.args[0][0]).to.deep.equal(req);
        chai.expect(getDoc.callCount).to.equal(1);
        chai.expect(send.callCount).to.equal(1);
        chai.expect(send.args[0][0]).to.equal('LOGIN PAGE GOES HERE. TRANSLATED VALUE.');
        chai.expect(readFile.callCount).to.equal(1);
      });
    });

    it('when branding doc missing when not logged in send login page', () => {
      const getUserCtx = sinon.stub(auth, 'getUserCtx').rejects('not logged in');
      const getDoc = sinon.stub(db, 'get').rejects({ error: 'not_found', docId: 'branding'});
      const send = sinon.stub(res, 'send');
      sinon.stub(fs, 'readFile').callsArgWith(2, null, 'LOGIN PAGE GOES HERE. {{translations.login}}');
      sinon.stub(config, 'translate').returns('TRANSLATED VALUE.');
      return controller.get(req, res).then(() => {
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(getUserCtx.args[0][0]).to.deep.equal(req);
        chai.expect(getDoc.callCount).to.equal(1);
        chai.expect(send.callCount).to.equal(1);
        chai.expect(send.args[0][0]).to.equal('LOGIN PAGE GOES HERE. TRANSLATED VALUE.');
      });
    });
  });

  describe('post', () => {

    it('returns errors from session create', () => {
      req.body = { user: 'sharon', password: 'p4ss' };
      const post = sinon.stub(request, 'post').rejects('boom');
      const status = sinon.stub(res, 'status').returns(res);
      const json = sinon.stub(res, 'json').returns(res);
      return controller.post(req, res).then(() => {
        chai.expect(post.callCount).to.equal(1);
        chai.expect(status.callCount).to.equal(1);
        chai.expect(status.args[0][0]).to.equal(500);
        chai.expect(json.callCount).to.equal(1);
        chai.expect(json.args[0][0]).to.deep.equal({ error: 'Unexpected error logging in' });
      });
    });

    it('returns invalid credentials', () => {
      req.body = { user: 'sharon', password: 'p4ss' };
      const post = sinon.stub(request, 'post').resolves({ statusCode: 401 });
      const status = sinon.stub(res, 'status').returns(res);
      const json = sinon.stub(res, 'json').returns(res);
      return controller.post(req, res).then(() => {
        chai.expect(post.callCount).to.equal(1);
        chai.expect(status.callCount).to.equal(1);
        chai.expect(status.args[0][0]).to.equal(401);
        chai.expect(json.callCount).to.equal(1);
        chai.expect(json.args[0][0]).to.deep.equal({ error: 'Not logged in' });
      });
    });

    it('returns errors from auth', () => {
      req.body = { user: 'sharon', password: 'p4ss' };
      const postResponse = {
        statusCode: 200,
        headers: { 'set-cookie': [ 'AuthSession=abc;' ] }
      };
      const post = sinon.stub(request, 'post').resolves(postResponse);
      const status = sinon.stub(res, 'status').returns(res);
      const json = sinon.stub(res, 'json').returns(res);
      const getUserCtx = sinon.stub(auth, 'getUserCtx').rejects('boom');
      return controller.post(req, res).then(() => {
        chai.expect(post.callCount).to.equal(1);
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(status.callCount).to.equal(1);
        chai.expect(status.args[0][0]).to.equal(401);
        chai.expect(json.callCount).to.equal(1);
        chai.expect(json.args[0][0]).to.deep.equal({ error: 'Error getting authCtx' });
      });
    });

    it('logs in successfully', () => {
      req.body = { user: 'sharon', password: 'p4ss' };
      const postResponse = {
        statusCode: 200,
        headers: { 'set-cookie': [ 'AuthSession=abc;' ] }
      };
      const post = sinon.stub(request, 'post').resolves(postResponse);
      const send = sinon.stub(res, 'send');     
      const status = sinon.stub(res, 'status').returns(res);
      const cookie = sinon.stub(res, 'cookie').returns(res);
      const userCtx = { name: 'shazza', roles: [ 'project-stuff' ] };
      const getUserCtx = sinon.stub(auth, 'getUserCtx').resolves(userCtx);
      const hasAllPermissions = sinon.stub(auth, 'hasAllPermissions').returns(false);
      return controller.post(req, res).then(() => {
        chai.expect(post.callCount).to.equal(1);
        chai.expect(post.args[0][0].url).to.equal('http://test.com:1234/_session');
        chai.expect(post.args[0][0].body.name).to.equal('sharon');
        chai.expect(post.args[0][0].body.password).to.equal('p4ss');
        chai.expect(post.args[0][0].auth.user).to.equal('sharon');
        chai.expect(post.args[0][0].auth.pass).to.equal('p4ss');
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(getUserCtx.args[0][0].headers.Cookie).to.equal('AuthSession=abc;');
        chai.expect(hasAllPermissions.callCount).to.equal(1);
        chai.expect(status.callCount).to.equal(1);
        chai.expect(status.args[0][0]).to.equal(302);
        chai.expect(send.args[0][0]).to.deep.equal('/lg/_design/medic/_rewrite');
        chai.expect(cookie.callCount).to.equal(2);
        chai.expect(cookie.args[0][0]).to.equal('AuthSession');
        chai.expect(cookie.args[0][1]).to.equal('abc');
        chai.expect(cookie.args[0][2]).to.deep.equal({ sameSite: 'lax', secure: false, httpOnly: true });
        chai.expect(cookie.args[1][0]).to.equal('userCtx');
        chai.expect(cookie.args[1][1]).to.equal(JSON.stringify(userCtx));
        chai.expect(cookie.args[1][2]).to.deep.equal({ sameSite: 'lax', secure: false, maxAge: 31536000000 });
      });
    });

    it('redict admin users to admin app after successful login', () => {
      req.body = { user: 'sharon', password: 'p4ss' };
      const postResponse = {
        statusCode: 200,
        headers: { 'set-cookie': [ 'AuthSession=abc;' ] }
      };
      const post = sinon.stub(request, 'post').resolves(postResponse);
      const send = sinon.stub(res, 'send');     
      const status = sinon.stub(res, 'status').returns(res);
      const userCtx = { name: 'shazza', roles: [ 'project-stuff' ] };
      const getUserCtx = sinon.stub(auth, 'getUserCtx').resolves(userCtx);
      const hasAllPermissions = sinon.stub(auth, 'hasAllPermissions').returns(true);
      return controller.post(req, res).then(() => {
        chai.expect(post.callCount).to.equal(1);
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(getUserCtx.args[0][0].headers.Cookie).to.equal('AuthSession=abc;');
        chai.expect(hasAllPermissions.callCount).to.equal(1);
        chai.expect(status.callCount).to.equal(1);
        chai.expect(status.args[0][0]).to.equal(302);
        chai.expect(send.args[0][0]).to.deep.equal('/lg/_design/medic-admin/_rewrite');
      });
    });
  });

  describe('getIdentity', () => {

    it('refreshes user cookie on valid identity call', () => {
      res.type = sinon.stub();
      const userCtx = { name: 'alpha', roles: [ 'omega' ] };
      const getUserCtx = sinon.stub(auth, 'getUserCtx').resolves(userCtx);
      const cookie = sinon.stub(res, 'cookie').returns(res);
      const send = sinon.stub(res, 'send');

      return controller.getIdentity(req, res).then(() => {
        chai.expect(cookie.callCount).to.equal(1);
        chai.expect(cookie.args[0][0]).to.equal('userCtx');
        chai.expect(cookie.args[0][1]).to.equal(JSON.stringify(userCtx));
        chai.expect(cookie.args[0][2]).to.deep.equal({ sameSite: 'lax', secure: false, maxAge: 31536000000 });
        chai.expect(res.type.args[0][0]).to.equal('application/json');
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(send.callCount).to.equal(1);
        chai.expect(send.args[0][0]).to.deep.equal({ success: true });
      });
    });

    it('does not set cookie on invalid identity call', () => {
      res.type = sinon.stub();
      res.status = sinon.stub();
      const getUserCtx = sinon.stub(auth, 'getUserCtx').returns(Promise.reject(true));
      const cookie = sinon.stub(res, 'cookie').returns(res);
      const send = sinon.stub(res, 'send');

      return controller.getIdentity(req, res).then(() => {
        chai.expect(cookie.callCount).to.equal(0);
        chai.expect(getUserCtx.callCount).to.equal(1);
        chai.expect(res.status.callCount).to.equal(1);
        chai.expect(res.status.args[0][0]).to.equal(401);
        chai.expect(send.callCount).to.equal(1);
      });
    });

  });

});
