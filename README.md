[![Chat](https://badges.gitter.im/chat.svg)](//gitter.im/lighterio/public)
[![Version](https://img.shields.io/npm/v/exam-mock.svg)](//www.npmjs.com/package/exam-mock)
[![Downloads](https://img.shields.io/npm/dm/exam-mock.svg)](//www.npmjs.com/package/exam-mock)
[![Build](https://img.shields.io/travis/lighterio/exam-mock.svg)](//travis-ci.org/lighterio/exam-mock)
[![Coverage](https://img.shields.io/coveralls/lighterio/exam-mock/master.svg)](//coveralls.io/r/lighterio/exam-mock)
[![Style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg)](//www.npmjs.com/package/standard)

`exam-mock` is a fast mocking library, designed to be used with `exam`, or any
other JavaScript test runner.

## Installation
Install `exam-mock`as a dev dependency:
```bash
npm install --save-dev exam-mock
```

## API
The `mock` library exposes 2 globals, `mock` and `unmock`:

```js
describe('myConsole', function () {
  it('calls console.log', function (done) {
    mock(console, {
      log: function () {
        unmock(console)
        done()
      }
    })
  })
})
```

### mock(object, mockedProperties)
When mock is used as a function, it accepts 2 objects. Any properties of the
second object will be copied onto the first object, and if those properties
were already defined on the first, they will be saved so they can be unmocked
later.

In addition, `mock` is an object with several methods for replacing methods
with simple functions that create testable output.

### mock.ignore()
Returns a function that does nothing.

```js
describe('myConsole', function () {
  it('.log does not throw an error', function () {
    mock(console, {
      log: mock.ignore()
    })
    // This logs nothing, despite calling console.log('a').
    myConsole.log('a')
  })
})
```

### mock.count()
Returns a function that increments its `value` property each time it is called.

```js
describe('myConsole', function () {
  it('.log calls console.log once', function () {
    mock(console, {
      log: mock.count()
    })
    is(console.log.value, 0)
    myConsole.log('a')
    is(console.log.value, 1)
    unmock(console)
  })
})
```

### mock.concat([delimiter])
Returns a function whose first argument is concatenated onto its `value`
property each time it is called.

```js
describe('myConsole', function () {
  it('.log calls console.log', function () {
    mock(console, {
      log: mock.concat()
    })
    is(console.log.value, '')
    myConsole.log('a')
    is(console.log.value, 'a')
    myConsole.log('b')
    is(console.log.value, 'ab')
    unmock(console)
  })
})
```

If a delimiter is supplied, it will be used to separate the concatenated
arguments.

```js
describe('myConsole', function () {
  it('.log calls console.log', function () {
    mock(console, {
      log: mock.concat(',')
    })
    is(console.log.value, '')
    myConsole.log(1)
    is(console.log.value, '1')
    myConsole.log(2)
    is(console.log.value, '1,2')
    unmock(console)
  })
})
```

### mock.args([index])
Returns a function that pushes its arguments into an array each time it is
called.

```js
describe('myConsole', function () {
  it('.log calls console.log with multiple arguments', function () {
    mock(console, {
      log: mock.args()
    })
    is.same(console.log.value, [])
    myConsole.log('a')
    is.same(console.log.value, [{0: 'a'}])
    myConsole.log('b', 'c')
    is.same(console.log.value, [{0: 'a'}, {0: 'b', 1: 'c'}])
    unmock(console)
  })
})
```

If an index is supplied, it only pushes one of the arguments.

```js
describe('myConsole', function () {
  it('.log calls console.log', function () {
    mock(console, {
      log: mock.args(0)
    });
    is.same(console.log.value, [])
    myConsole.log(1)
    is.same(console.log.value, [1])
    myConsole.log(2, 3)
    is.same(console.log.value, [1, 2])
    unmock(console)
  });
});
```

### mock.fs([config][, createNewFs])
Uses [`mock-fs`](https://www.npmjs.org/package/mock-fs) to create a temporary
in-memory file system for fast, reliable tests. If `createNewFs` is truthy,
Node's built-in [`fs` module](http://nodejs.org/api/fs.html) remains unchanged,
otherwise its methods are mocked.

```js
// Replace Node's `fs` with a temporary file system.
var fs = mock.fs({
  'path/to/fake/dir': {
    'some-file.txt': 'file content here',
    'empty-dir': {} // Empty directory.
  },
  'path/to/some.png': new Buffer([8, 6, 7, 5, 3, 0, 9])
})

// Verify that we can read content.
var content = fs.readFileSync('path/to/fake/dir/some-file.txt')
is(content.toString(), 'file content here')

// Restore Node's built-in file system.
unmock(fs)
```

Calling `mock.fs` sets up a mock file system and returns a reference to Node's
built-in `fs` module, whose methods are now mocked. The resulting file system
has two base directories, `process.cwd()` and `os.tmpdir()`, plus any
directories/files added by the optional `config` object.

A `config` object is a nested structure in which:
* Keys are paths, relative to `process.cwd()`.
* `Buffer` and `string` values are file contents.
* Plain `object` values are directories.

To create a file or directory with additional properties (owner, permissions,
atime, etc.), use `mock.file()` or `mock.directory()`.

**Caveats:**

* Paths should use forward slashes, even on Windows.

* When you use `mock.fs` without the `createNewFs` argument, Node's own `fs`
  module is modified. If you use it **before** any other modules that modify
  `fs` (e.g. `graceful-fs`), the mock should behave as expected.

* The following [`fs` functions](http://nodejs.org/api/fs.html) are overridden:
  `fs.ReadStream`, `fs.Stats`, `fs.WriteStream`, `fs.appendFile`,
  `fs.appendFileSync`, `fs.chmod`, `fs.chmodSync`, `fs.chown`, `fs.chownSync`,
  `fs.close`, `fs.closeSync`, `fs.createReadStream`, `fs.createWriteStream`,
  `fs.exists`, `fs.existsSync`, `fs.fchmod`, `fs.fchmodSync`, `fs.fchown`,
  `fs.fchownSync`, `fs.fdatasync`, `fs.fdatasyncSync`, `fs.fstat`,
  `fs.fstatSync`, `fs.fsync`, `fs.fsyncSync`, `fs.ftruncate`,
  `fs.ftruncateSync`, `fs.futimes`, `fs.futimesSync`, `fs.lchmod`,
  `fs.lchmodSync`, `fs.lchown`, `fs.lchownSync`, `fs.link`, `fs.linkSync`,
  `fs.lstatSync`, `fs.lstat`, `fs.mkdir`, `fs.mkdirSync`, `fs.open`,
  `fs.openSync`, `fs.read`, `fs.readSync`, `fs.readFile`, `fs.readFileSync`,
  `fs.readdir`, `fs.readdirSync`, `fs.readlink`, `fs.readlinkSync`,
  `fs.realpath`, `fs.realpathSync`, `fs.rename`, `fs.renameSync`, `fs.rmdir`,
  `fs.rmdirSync`, `fs.stat`, `fs.statSync`, `fs.symlink`, `fs.symlinkSync`,
  `fs.truncate`, `fs.truncateSync`, `fs.unlink`, `fs.unlinkSync`, `fs.utimes`,
  `fs.utimesSync`, `fs.write`, `fs.writeSync`, `fs.writeFile` and
  `fs.writeFileSync`.

* Mock `fs.Stats` objects have the following properties: `dev`, `ino`, `nlink`,
  `mode`, `size`, `rdev`, `blksize`, `blocks`, `atime`, `ctime`, `mtime`,
  `uid`, and `gid`.  In addition, all of the `is*()` methods are provided (e.g.
  `isDirectory()` and `isFile()`).

* Mock file access is controlled based on file mode where `process.getuid()` and
  `process.getgid()` are available (POSIX systems). On other systems (e.g.
  Windows) the file mode has no effect.

* The following `fs` functions are **not** currently mocked (if your tests use
  these, they will work against the real file system): `fs.FSWatcher`,
  `fs.unwatchFile`, `fs.watch`, and `fs.watchFile`.

### mock.file(properties)
Create a mock file. Supported properties:

 * **content** - `string|Buffer` File contents.
 * **mode** - `number` File mode (permission and sticky bits).  Defaults to `0666`.
 * **uid** - `number` The user id.  Defaults to `process.getuid()`.
 * **git** - `number` The group id.  Defaults to `process.getgid()`.
 * **atime** - `Date` The last file access time.  Defaults to `new Date()`.  Updated when file contents are accessed.
 * **ctime** - `Date` The last file change time.  Defaults to `new Date()`.  Updated when file owner or permissions change.
 * **mtime** - `Date` The last file modification time.  Defaults to `new Date()`.  Updated when file contents change.

```js
var old = new Date(1)
mock({
  foo: mock.file({
    content: 'file content here',
    ctime: old,
    mtime: old
  })
})
```

### mock.directory(properties)
Create a mock directory. Supported properties:

 * **mode** - `number` Directory mode (permission and sticky bits).  Defaults to `0777`.
 * **uid** - `number` The user id.  Defaults to `process.getuid()`.
 * **git** - `number` The group id.  Defaults to `process.getgid()`.
 * **atime** - `Date` The last directory access time.  Defaults to `new Date()`.
 * **ctime** - `Date` The last directory change time.  Defaults to `new Date()`.  Updated when owner or permissions change.
 * **mtime** - `Date` The last directory modification time.  Defaults to `new Date()`.  Updated when an item is added, removed, or renamed.
 * **items** - `Object` Directory contents.  Members will generate additional files, directories, or symlinks.

To create a mock filesystem with a directory with the relative path `some/dir` that has a mode of `0755` and a couple child files, you could do something like this:
```js
mock({
  'some/dir': mock.directory({
    mode: 0755,
    items: {
      file1: 'file one content',
      file2: new Buffer([8, 6, 7, 5, 3, 0, 9])
    }
  })
})
```

### mock.symlink(properties)
Create a mock symlink. Supported properties:

 * **path** - `string` Path to the source (required).
 * **mode** - `number` Symlink mode (permission and sticky bits).  Defaults to `0666`.
 * **uid** - `number` The user id.  Defaults to `process.getuid()`.
 * **git** - `number` The group id.  Defaults to `process.getgid()`.
 * **atime** - `Date` The last symlink access time.  Defaults to `new Date()`.
 * **ctime** - `Date` The last symlink change time.  Defaults to `new Date()`.
 * **mtime** - `Date` The last symlink modification time.  Defaults to `new Date()`.

```js
mock({
  'some/dir': {
    'regular-file': 'file contents',
    'a-symlink': mock.symlink({
      path: 'regular-file'
    })
  }
})
```

### unmock(object)
Restores the properties which belonged to the object prior to being mocked.

## More on exam-mock...
* [Contributing](//github.com/lighterio/exam-mock/blob/master/CONTRIBUTING.md)
* [License (ISC)](//github.com/lighterio/exam-mock/blob/master/LICENSE.md)
* [Change Log](//github.com/lighterio/exam-mock/blob/master/CHANGELOG.md)
* [Roadmap](//github.com/lighterio/exam-mock/blob/master/ROADMAP.md)
