# Deno-Spring

A compact, high-performance and full-featured web server framework in Deno.

## Shortcut mode

Create a `mod.ts` file and write the following content, then run `deno run --allow-all mod.ts`.

```ts
import { Bootstrap, Server } from "https://deno.land/x/spring/mod.ts";

@Bootstrap
export default class {
    constructor(app: Server) {
        app.get("/:id", (ctx) => {
            return "hello " + ctx.params.id;
        });
    }
}
```

Note that features such as components, template engine and unified error handling
 cannot be used in shortcut mode, you must solve them in other ways.

## Decorator mode

Decorator mode and shortcut mode do not conflict and can be used together. The only
difference in performance between the two is that the latter needs to parse all
decorators at startup, it is almost the same in runtime.

In decorator mode, you must first create a configuration file named `deno.jsonc` with
 the following content:
```
{
    "compilerOptions": {
        "emitDecoratorMetadata": true,
    }
}
```

Then modify the content of `mod.ts` as follows, in order to inject all components with
 decorators into the application by `app.modules` method.

```ts
@Bootstrap
export default class {
    constructor(app: Server) {
        app.modules(Authenticator, ErrorController, UserController, UserService);
        app.assets("/static/*");
    }
}
```

### 1. Interceptor

The interceptor is not required, but if there is one, the methods in it will be executed
 in order.

```ts
// Authenticator.ts
@Interceptor
export class Authenticator {
    cors(ctx: Context) {
        // do something first
    }
    auth(ctx: Context) {
        // do something second
    }
}
```

### 2. ErrorHandler

If an error handler component is defined, all errors within the framework will
 be handled by it.

```ts
// ErrorController.ts
@Component
export class ErrorController {
    @ErrorHandler
    error(ctx: Context, err: Error) {
        return {
            status: ctx.status,
            message: err.message,
        };
    }
}
```

### 3. Controller

Create a routing controller and inject a service class.

```ts
// UserController.ts
@Controller("/prefix")
export class UserController {
    @Autowired
    userService!: UserService;

    @Get("/:id")
    getUser(ctx: Context) {
        return this.userService.getUser(ctx.params.id);
    }
}
```

If you want to use the service class in the constructor, you need to refer to the following usage:

```ts
// UserController.ts
@Controller("/prefix")
export class UserController {
    constructor(public userService: UserService) {
        this.userService.init();
    }

    @Get("/:id")
    getUser(ctx: Context) {
        return this.userService.getUser(ctx.params.id);
    }
}
```

### 4. Component

```ts
// UserService.ts
@Component
export class UserService {
    getUser(id: string) {
        // do something
    }
}
```

### 5. View

View decorator are used to decorate controller methods, and its parameter is
the template file path. After adding it, the built-in template engine will be
used for rendering automatically. The built-in engine syntax see [SYNTAX.md](/SYNTAX.md)

```ts
// mod.ts
@Bootstrap
export default class {
    constructor(app: Server) {
        app.modules(Authenticator, ErrorController, UserController, UserService);
        app.assets("/assets/*");

        // Add the following code for template engine
        app.views("./views");
        app.imports({ formatDate });
    }
}

// UserController.ts
@Controller("/prefix")
export class UserController {
    @Autowired
    userService!: UserService;

    @Get("/:id")
    @View("index.html") // or @View("./project/path/index.html") if options not initialized
    getUser(ctx: Context) {
        return this.userService.getUser(ctx.params.id);
    }
}

// index.html
<h1>Hello, {{= name }} {{= formatDate(birthdate) }}</h1>
```

## API Reference

### app: Server

- `app.port` HTTP server listening port, default 3000.
- `app.hostname` HTTP server hostname, default "0.0.0.0"
- `app.views` The root of template files, default ""
- `app.imports` Global imports for template, default {}
- `app.assets` The paths of static resources
- `app.modules` Load classes that need to use decorator in the application
- `app.get`, `app.post`, `app.put`... Request methods with `(path, handler)` parameters

### Decorators

| Name          | Type              | Parameters | description                   |
| ------------- | ----------------- | ---------- | ----------------------------- |
| @Bootstrap    | ClassDecorator    |            | Application startup class     |
| @Interceptor  | ClassDecorator    |            | Define a interceptor          |
| @Component    | ClassDecorator    |            | Define a component            |
| @Controller   | ClassDecorator    | string     | Prefix for request route      |
| @Autowired    | PropertyDecorator |            | Inject components             |
| @ErrorHandler | MethodDecorator   |            |                               |
| @View         | MethodDecorator   | string     | Template file path            |
| @Get          | MethodDecorator   | string     | Route path                    |
| @Post         | MethodDecorator   | string     | Route path                    |
| @Put          | MethodDecorator   | string     | Route path                    |
| @Delete       | MethodDecorator   | string     | Route path                    |
| @Patch        | MethodDecorator   | string     | Route path                    |
| @Head         | MethodDecorator   | string     | Route path                    |
| @Options      | MethodDecorator   | string     | Route path                    |

### Context

Context is an instance passed to controllers, Interceptors and error handler, it
contains properties and methods related to requests and responses.

#### Request Properties

- `ctx.params` The parameters on route path
- `ctx.query` The parameters on query string
- `ctx.url` ex. https://example.com:3000/users?page=1
- `ctx.origin` ex. https://example.com:3000
- `ctx.protocol` ex. https:
- `ctx.host` ex. example.com:3000
- `ctx.hostname` ex. example.com
- `ctx.port` ex. 3000
- `ctx.path` ex. /users
- `ctx.method` Standard http request methods
- `ctx.has`, `ctx.get` Shortcuts for obtain reqeust headers. Refer to
  https://deno.com/deploy/docs/runtime-headers
- `ctx.cookies` Including one method to get request cookie:
  `ctx.cookies.get(name)`
- `ctx.text`, `ctx.json`, `ctx.form`, `ctx.blob`, `ctx.buffer` Promised methods to parse request body.

#### Response Properties

- `ctx.status`
- `ctx.status=`
- `ctx.statusText`
- `ctx.statusText=`
- `ctx.cookies` Including two methods to operate response cookie:
  `set(name, value)`,`delete(name)`

#### Response Methods

- `ctx.set(name, value)` The following 3 methods are used to manipulate response
  headers
- `ctx.redirect(url[, status])` Redirect url with default status code 308.

#### Others

- `ctx.view(tmplFile, data)` If the controller method does not add a `@View`
  decorator, you can call this method to return the rendered text content.
- `ctx.render(tmplText, data)` Render template text, usually not needed.

#### Return types

Controller methods are allowed to return the following object types:

- `BodyInit`: Blob, BufferSource, FormData, ReadableStream, URLSearchParams, or
  USVString
- `Response`: Native response instance.
