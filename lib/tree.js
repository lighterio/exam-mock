var Emitter = require('./common/emitter');

/**
 * Run a `tree` of assigned test files.
 * In single process mode, files are passed via `options` from `lib/exam.js`.
 * In multi-process mode, files are specified via the `--files` argument.
 */
var tree = module.exports = function (options) {

  options = options || require('./options')();
  var grep = options.grep;
  var ignore = options.ignore;
  var reporter = require('./reporters/' + options.reporter);
  var stream = reporter.stream = options.stream;
  var showProgress = reporter.init && !options.hideProgress;
  if (showProgress) {
    reporter.init(options);
  }

  /**
   * Reference `setTimeout` and `clearTimeout` directly in case they get mocked.
   */
  var timers = require('timers');
  var setTimeout = timers.setTimeout;
  var clearTimeout = timers.clearTimeout;

  /**
   * Make Exam's built-in assertions and mocks globally available.
   */
  global.is = require('./is');
  global.mock = require('./mock');

  /**
   * Track the phases suites and tests with constants.
   */
  var WAIT = 0;
  var BEFORE = 1;
  var RUN = 2;
  var CHILDREN = 3;
  var AFTER = 4;
  var END = 5;
  var phases = ['WAIT', 'BEFORE', 'RUN', 'CHILDREN', 'AFTER', 'END'];

  /**
   * Store test prep functions in an array.
   */
  var prepKeys = ['beforeEach', 'afterEach'];
  var prep = [null, null];
  var BEFORE_EACH = 0;
  var AFTER_EACH = 1;
  var asyncPattern = /^function.*?\([^\s\)]/;

  var debug = function (message) {
    stream.write(message + '\n');
  };

  /**
   * Use an EcmaScript parser to preempt SyntaxError logging.
   */
  if (options.parser && !process.env.running_under_istanbul) {

    var parser = require(options.parser);
    var parserExp = /(^[\s|\S]+?[\/\\](esprima|acorn)\.js:\d+:\d+\))[\s\S]*$/;
    var Module = require('module');
    var resolve = Module._resolveFilename;
    var parsingPath = '';

    // Capture the path of each module we require.
    Module._resolveFilename = function () {
      var path = resolve.apply(Module, arguments);
      // If we're not inside another module, enable parsing on this path.
      if (path.indexOf('node_modules') < 0) {
        parsingPath = path;
      }
      return path;
    };

    // TODO: Test this method of module wrapping in older Node versions.
    Module.wrap = function (script) {
      if (parsingPath) {
        var error;
        try {
          // The speed of `eval` is ~3x Acorn and ~5x Esprima.
          eval('var f=function(){' + script + '}'); // jshint ignore:line
        }
        catch (e) {
          // If eval failed, use Acorn or Esprima to find the line and column.
          parser.parse(script);
        }
        parsingPath = '';
      }
      script = Module.wrapper[0] + script + Module.wrapper[1];
      return script;
    };

  }

  /**
   * Assign uncaught exceptions and continue.
   */
  process.on('uncaughtException', function (error) {
    fail(context, error);
    next();
  });

  /**
   * If continuing past failed assertions, listen for results.
   */
  if (options.continueAsserts) {
    Emitter.extend(is);
    is.on('result', function (result) {
      if (result instanceof Error) {
        fail(context, result);
      }
      (context.results = context.results || []).push(result);
    });
  }

  function stub() {
    if (showProgress) {
      reporter.stub();
    }
  }

  function bubble(parent, key, value) {
    while (parent) {
      parent[key] = value;
      parent = parent.parent;
    }
  }

  /**
   * Fail a test or suite on the first error.
   */
  function fail(context, e) {
    if (!context.error) {
      if (showProgress) {
        reporter.fail();
      }
      root.bail = options.bail;

      var stack = (e.stack || e.message || e.toString());

      // Add a stack line to show the line and column of a parsing error.
      if (parsingPath) {
        stack = stack.replace(parserExp, function (match, slice) {
          var pos = parsingPath + ':';
          // Acorn.
          if (e.loc) {
            slice = slice.replace(/ ?\(\d+:\d+\)\n/, '\n');
            pos += e.loc.line + ':' + (e.loc.column + 1);
          }
          // Esprima.
          else {
            slice = slice.replace(/^Error: Line \d+/, 'SyntaxError');
            pos += e.lineNumber + ':' + e.column;
          }
          return slice.replace(/\n/, '\n    at script (' + pos + ')\n');
        });
        parsingPath = '';
      }
      context.error = stack;
    }
  }

  /**
   * Create a suite or test.
   */
  function Node(name, fn, only, skip) {
    var node = this;
    node.parent = suite;
    node.name = name;
    node.fn = fn;
    node.phase = WAIT;
    node.time = 0;
    node.index = 0;
    if (suite) {
      node.timeLimit = suite.timeLimit;
      node.hasOnly = false;
      node.only = (suite.only && !skip) || only || false;
      node.skip = suite.skip || skip || false;
      suite.children.push(node);
      if (only) {
        bubble(suite, 'hasOnly', true);
      }
    }
    else {
      node.timeLimit = options.timeout;
      node.skip = node.only = node.hasOnly = false;
    }
  }

  /**
   * Set a suite or test's time limit, and start the timer.
   */
  Node.prototype.timeout = function (time) {
    var node = this;
    node.timeLimit = time;
    clearTimeout(Node.timer);
    if (time > 0) {
      Node.timer = setTimeout(function () {
        fail(context, new Error('Timeout of ' + time + 'ms exceeded.'));
      }, time);
    }
  };

  /**
   * Run the next phase or function of the current suite or test.
   */
  function next() {
    var i, j, l, fns, fn, key, prepStack, n = 0;
    while (true) {
      if (!node) {
        root.timeout(0);
        return finishTree();
      }
      var name = node.name;
      var phase = node.phase;
      var isSuite = node.children ? true : false;
      if (isSuite) {
        suite = node;
      }

      switch (node.phase) {

        case WAIT:
          //debug('WAIT: ' + name);
          node.time = Date.now();
          if (node.file && !root.started[node.file]) {
            root.started[node.file] = node.time;
          }
          node.phase = BEFORE;
          // If it's a suite, run its function to discover contents.
          if (isSuite) {
            suite = context = node;
            fn = node.fn;
            break;
          }

        case BEFORE:
          //debug('BEFORE' + node.index + ': ' + name);
          fns = (isSuite ? node.before : prep[0]);
          if (fns) break;

        case RUN:
          //debug('RUN: ' + name);
          context = node;
          node.index = 0;
          if (isSuite) {
            suite = node;
            //debug('PUSH: ' + name);
            // Push `beforeEach`/`afterEach` functions into the `prepStack`.
            for (i = 0; i < 2; i++) {
              key = prepKeys[i];
              fns = node[key];
              if (fns) {
                prepStack = prep[i] = prep[i] || [];
                if (typeof fns == 'function') {
                  prepStack.push(fns);
                  node[key] = 1;
                }
                else if (fns instanceof Array) {
                  for (j = 0, l = fns.length; j < l; j++) {
                    prepStack.push(fns[j]);
                  }
                  node[key] = fns.length;
                }
                fns = null;
              }
            }
            node.phase = CHILDREN;
          }
          else {
            fn = node.fn;
            node.phase = AFTER;
            break;
          }

        case CHILDREN:
          //debug('CHILDREN' + node.index + ': ' + name + ' - ' + n);
          var child = node.children[node.index++];
          if (child) {
            if (child.skip && !child.children) {
              if (showProgress) {
                reporter.skip();
              }
            }
            else if (!child.fn && !child.children) {
              if (showProgress) {
                reporter.stub();
              }
            }
            else {
              node = child;
            }
            continue;
          }
          else {
            //debug('POP: ' + name);
            // Pop `beforeEach`/`afterEach` functions from `prep` stacks.
            for (i = 0; i < 2; i++) {
              key = prepKeys[i];
              l = node[key];
              if (l) {
                prepStack = prep[i];
                prepStack.splice(prepStack.length - l, l);
              }
            }
          }

        case AFTER:
          //debug('AFTER' + node.index + ': ' + name);
          fns = (isSuite ? node.after : prep[1]);
          if (fns) break;

        case END:
          //debug('END: ' + name);
          var now = Date.now();
          node.time = now - node.time;
          if (node.file) {
            root.times[node.file] = now - root.started[node.file];
          }
          if (showProgress && !isSuite) {
            reporter.pass();
          }
          node.phase = END;
          node = root.bail ? null : node.parent;
          continue;
      }

      if (fns) {
        if (typeof fns == 'function') {
          fn = fns;
          node.phase++;
        }
        else {
          fn = fns[node.index++];
        }
        fns = null;
      }
      if (fn) {
        //debug(fn.toString().replace(/\s+/g, ' '));
        if (asyncPattern.test(fn.toString())) {
          var ctx = context;
          var isDone = false;
          ctx.timeout(ctx.timeLimit);
          try {
            fn.call(ctx, function () {
              if (isDone) {
                fail(ctx, new Error('Called `done` multiple times.'));
              }
              else {
                isDone = true;
                next();
              }
            });
            return;
          }
          catch (e) {
            fail(ctx, e);
            isDone = true;
          }
        }
        else {
          (function (ctx) {
            try {
              fn.call(ctx);
            }
            catch (e) {
              fail(ctx, e);
            }
          })(context);
        }
        fn = null;
      }
      else {
        //debug('ADVANCE from ' + phases[node.phase] + ': ' + name + ' - ' + n);
        node.index = 0;
        node.phase++;
      }
    }
  }

  /**
   * Create a test suite.
   */
  global.describe = function (name, fn, only, skip) {
    var node = new Node(name, fn, only, skip);
    node.children = [];
    if (root && (node.parent == root)) {
      node.file = root.file;
    }
    return node;
  };

  /**
   * Create a test.
   */
  global.it = function (name, fn, only, skip) {
    var node = new Node(name, fn, only, skip);
    return node;
  };

  // Create `only` and `skip` methods for `it` and `describe`.
  [describe, it].forEach(function (me) {
    me.only = function (name, fn) {
      return me(name, fn, true, false);
    };
    me.skip = function (name, fn) {
      return me(name, fn, false, true);
    };

    // Apply a filter to a function by wrapping it.
    function filterFunction(object, key) {
      var fn = object[key];
      return (object[key] = function (name) {
        var title = suite ? suite.title : '';
        title += (title && (name[0] != '.') ? '' : ' ') + name;
        var isMatch = !grep || !root || grep.test(title) || grep.test(root.file);
        if (!ignore || !ignore.test(title)) {
          var item = fn.apply(root, arguments);
          item.title = title;
          if (grep) {
            item.isMatch = isMatch;
            if (isMatch) {
              bubble(suite, 'hasMatches', true);
            }
          }
          return item;
        }
      });
    }

    // Optionally wrap methods with RegExp matching.
    if (grep || ignore) {
      var isTest = (me == it);
      var key = isTest ? 'it' : 'describe';
      var fn = filterFunction(global, key);
      fn.only = me.only;
      fn.skip = me.skip;
      filterFunction(fn, 'only');
      filterFunction(fn, 'skip');
    }
  });

  // Wrap `it` and `describe` with grep/ignore code if necessary.


  /**
   * Set a function to be run before a suite's tests.
   */
  global.before = global.setup = function (fn) {
    addSuiteFunction(suite, 'before', fn);
  };

  /**
   * Set a function to be run after a suite's tests.
   */
  global.after = global.teardown = function (fn) {
    addSuiteFunction(suite, 'after', fn);
  };

  /**
   * Set a function to be run before each test in a suite.
   */
  global.beforeEach = function (fn) {
    addSuiteFunction(suite, 'beforeEach', fn);
  };

  /**
   * Set a function to be run after each test in a suite.
   */
  global.afterEach = function (fn) {
    addSuiteFunction(suite, 'afterEach', fn);
  };

  /**
   * Add a before/after/beforeEach/afterEach function to a suite.
   */
  function addSuiteFunction(suite, key, fn) {
    process.assert(typeof fn == 'function', 'Exam `' + key + '` accepts a function as its only argument.');
    // Set a function or an array of functions.
    var fns = suite[key];
    if (!fns) {
      suite[key] = fn;
    }
    else if (typeof fns == 'function') {
      suite[key] = [fns, fn];
    }
    else if (fns instanceof Array) {
      fns.push(fn);
    }
    else {
      throw new Error('Attempted to create a preparation function after starting a suite.');
    }
  }

  /**
   * Optionally remove nodes that didn't match the grep option.
   */
  function grepNode(node) {
    var children = node.children;
    for (var i = 0, l = children.length; i < l; i++) {
      var child = children[i];
      // If the node isn't a match, we may prune it.
      if (child && !child.isMatch) {
        // If it has matching children, dive deeper.
        if (child.hasMatches) {
          grepNode(child);
        }
        // If it doesn't match and has no matches, remove it.
        else {
          children.splice(i--, 1);
        }
      }
    }
  }

  /**
   * After all suites and tests, send results up to the master CPU.
   */
  function finishTree() {
    if (grep) {
      grepNode(root);
    }
    root.options = options;
    var data = reporter.finishTree(root, {
      id: options.id,
      times: root.times,
      output: '',
      passed: 0,
      failed: 0,
      hasOnly: root.hasOnly,
      skipped: 0,
      stubbed: 0
    });
    try {
      process.send(data);
      if (options.multiProcess) {
        process.exit();
      }
    }
    catch (e) {
      stream.write(e.stack + '\n');
    }
  }

  // Discover suites and tests by requiring all files assigned to this CPU.
  var root = describe('', function () {
    // Track times for each file.
    root.started = {};
    root.times = {};
    options.files.forEach(function (file) {
      var path = options.dir + '/' + file;
      root.file = file;
      try {
        delete require.cache[path];
        require(path);
      }
      catch (e) {
        if (!grep || grep.test(path)) {
          var suite = describe('File: ' + path, function () {}, false, false);
          suite.grep = true;
          fail(suite, e);
        }
      }
    });
    root.file = null;
  });

  var node = root;
  var suite = root;
  var context = root;

  next();

};