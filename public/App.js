'use strict';

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function subscribe(store, ...callbacks) {
    if (store == null) {
        return noop;
    }
    const unsub = store.subscribe(...callbacks);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function get_store_value(store) {
    let value;
    subscribe(store, _ => value = _)();
    return value;
}
function null_to_empty(value) {
    return value == null ? '' : value;
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, bubbles, cancelable, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail, { cancelable = false } = {}) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail, { cancelable });
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
            return !event.defaultPrevented;
        }
        return true;
    };
}
function setContext(key, context) {
    get_current_component().$$.context.set(key, context);
    return context;
}
function getContext(key) {
    return get_current_component().$$.context.get(key);
}
Promise.resolve();
const ATTR_REGEX = /[&"]/g;
const CONTENT_REGEX = /[&<]/g;
/**
 * Note: this method is performance sensitive and has been optimized
 * https://github.com/sveltejs/svelte/pull/5701
 */
function escape(value, is_attr = false) {
    const str = String(value);
    const pattern = is_attr ? ATTR_REGEX : CONTENT_REGEX;
    pattern.lastIndex = 0;
    let escaped = '';
    let last = 0;
    while (pattern.test(str)) {
        const i = pattern.lastIndex - 1;
        const ch = str[i];
        escaped += str.substring(last, i) + (ch === '&' ? '&amp;' : (ch === '"' ? '&quot;' : '&lt;'));
        last = i + 1;
    }
    return escaped + str.substring(last);
}
function each(items, fn) {
    let str = '';
    for (let i = 0; i < items.length; i += 1) {
        str += fn(items[i], i);
    }
    return str;
}
const missing_component = {
    $$render: () => ''
};
function validate_component(component, name) {
    if (!component || !component.$$render) {
        if (name === 'svelte:component')
            name += ' this={...}';
        throw new Error(`<${name}> is not a valid SSR component. You may need to review your build config to ensure that dependencies are compiled, rather than imported as pre-compiled modules`);
    }
    return component;
}
let on_destroy;
function create_ssr_component(fn) {
    function $$render(result, props, bindings, slots, context) {
        const parent_component = current_component;
        const $$ = {
            on_destroy,
            context: new Map(context || (parent_component ? parent_component.$$.context : [])),
            // these will be immediately discarded
            on_mount: [],
            before_update: [],
            after_update: [],
            callbacks: blank_object()
        };
        set_current_component({ $$ });
        const html = fn(result, props, bindings, slots);
        set_current_component(parent_component);
        return html;
    }
    return {
        render: (props = {}, { $$slots = {}, context = new Map() } = {}) => {
            on_destroy = [];
            const result = { title: '', head: '', css: new Set() };
            const html = $$render(result, props, {}, $$slots, context);
            run_all(on_destroy);
            return {
                html,
                css: {
                    code: Array.from(result.css).map(css => css.code).join('\n'),
                    map: null // TODO
                },
                head: result.title + result.head
            };
        },
        $$render
    };
}
function add_attribute(name, value, boolean) {
    if (value == null || (boolean && !value))
        return '';
    const assignment = (boolean && value === true) ? '' : `="${escape(value, true)}"`;
    return ` ${name}${assignment}`;
}

const subscriber_queue = [];
/**
 * Creates a `Readable` store that allows reading by subscription.
 * @param value initial value
 * @param {StartStopNotifier}start start and stop notifications for subscriptions
 */
function readable(value, start) {
    return {
        subscribe: writable(value, start).subscribe
    };
}
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = new Set();
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (const subscriber of subscribers) {
                    subscriber[1]();
                    subscriber_queue.push(subscriber, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.add(subscriber);
        if (subscribers.size === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            subscribers.delete(subscriber);
            if (subscribers.size === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}
function derived(stores, fn, initial_value) {
    const single = !Array.isArray(stores);
    const stores_array = single
        ? [stores]
        : stores;
    const auto = fn.length < 2;
    return readable(initial_value, (set) => {
        let inited = false;
        const values = [];
        let pending = 0;
        let cleanup = noop;
        const sync = () => {
            if (pending) {
                return;
            }
            cleanup();
            const result = fn(single ? values[0] : values, set);
            if (auto) {
                set(result);
            }
            else {
                cleanup = is_function(result) ? result : noop;
            }
        };
        const unsubscribers = stores_array.map((store, i) => subscribe(store, (value) => {
            values[i] = value;
            pending &= ~(1 << i);
            if (inited) {
                sync();
            }
        }, () => {
            pending |= (1 << i);
        }));
        inited = true;
        sync();
        return function stop() {
            run_all(unsubscribers);
            cleanup();
        };
    });
}

const LOCATION = {};
const ROUTER = {};

/**
 * Adapted from https://github.com/reach/router/blob/b60e6dd781d5d3a4bdaaf4de665649c0f6a7e78d/src/lib/history.js
 *
 * https://github.com/reach/router/blob/master/LICENSE
 * */

function getLocation(source) {
  return {
    ...source.location,
    state: source.history.state,
    key: (source.history.state && source.history.state.key) || "initial"
  };
}

function createHistory(source, options) {
  const listeners = [];
  let location = getLocation(source);

  return {
    get location() {
      return location;
    },

    listen(listener) {
      listeners.push(listener);

      const popstateListener = () => {
        location = getLocation(source);
        listener({ location, action: "POP" });
      };

      source.addEventListener("popstate", popstateListener);

      return () => {
        source.removeEventListener("popstate", popstateListener);

        const index = listeners.indexOf(listener);
        listeners.splice(index, 1);
      };
    },

    navigate(to, { state, replace = false } = {}) {
      state = { ...state, key: Date.now() + "" };
      // try...catch iOS Safari limits to 100 pushState calls
      try {
        if (replace) {
          source.history.replaceState(state, null, to);
        } else {
          source.history.pushState(state, null, to);
        }
      } catch (e) {
        source.location[replace ? "replace" : "assign"](to);
      }

      location = getLocation(source);
      listeners.forEach(listener => listener({ location, action: "PUSH" }));
    }
  };
}

// Stores history entries in memory for testing or other platforms like Native
function createMemorySource(initialPathname = "/") {
  let index = 0;
  const stack = [{ pathname: initialPathname, search: "" }];
  const states = [];

  return {
    get location() {
      return stack[index];
    },
    addEventListener(name, fn) {},
    removeEventListener(name, fn) {},
    history: {
      get entries() {
        return stack;
      },
      get index() {
        return index;
      },
      get state() {
        return states[index];
      },
      pushState(state, _, uri) {
        const [pathname, search = ""] = uri.split("?");
        index++;
        stack.push({ pathname, search });
        states.push(state);
      },
      replaceState(state, _, uri) {
        const [pathname, search = ""] = uri.split("?");
        stack[index] = { pathname, search };
        states[index] = state;
      }
    }
  };
}

// Global history uses window.history as the source if available,
// otherwise a memory history
const canUseDOM = Boolean(
  typeof window !== "undefined" &&
    window.document &&
    window.document.createElement
);
const globalHistory = createHistory(canUseDOM ? window : createMemorySource());
const { navigate } = globalHistory;

/**
 * Adapted from https://github.com/reach/router/blob/b60e6dd781d5d3a4bdaaf4de665649c0f6a7e78d/src/lib/utils.js
 *
 * https://github.com/reach/router/blob/master/LICENSE
 * */

const paramRe = /^:(.+)/;

const SEGMENT_POINTS = 4;
const STATIC_POINTS = 3;
const DYNAMIC_POINTS = 2;
const SPLAT_PENALTY = 1;
const ROOT_POINTS = 1;

/**
 * Check if `segment` is a root segment
 * @param {string} segment
 * @return {boolean}
 */
function isRootSegment(segment) {
  return segment === "";
}

/**
 * Check if `segment` is a dynamic segment
 * @param {string} segment
 * @return {boolean}
 */
function isDynamic(segment) {
  return paramRe.test(segment);
}

/**
 * Check if `segment` is a splat
 * @param {string} segment
 * @return {boolean}
 */
function isSplat(segment) {
  return segment[0] === "*";
}

/**
 * Split up the URI into segments delimited by `/`
 * @param {string} uri
 * @return {string[]}
 */
function segmentize(uri) {
  return (
    uri
      // Strip starting/ending `/`
      .replace(/(^\/+|\/+$)/g, "")
      .split("/")
  );
}

/**
 * Strip `str` of potential start and end `/`
 * @param {string} str
 * @return {string}
 */
function stripSlashes(str) {
  return str.replace(/(^\/+|\/+$)/g, "");
}

/**
 * Score a route depending on how its individual segments look
 * @param {object} route
 * @param {number} index
 * @return {object}
 */
function rankRoute(route, index) {
  const score = route.default
    ? 0
    : segmentize(route.path).reduce((score, segment) => {
        score += SEGMENT_POINTS;

        if (isRootSegment(segment)) {
          score += ROOT_POINTS;
        } else if (isDynamic(segment)) {
          score += DYNAMIC_POINTS;
        } else if (isSplat(segment)) {
          score -= SEGMENT_POINTS + SPLAT_PENALTY;
        } else {
          score += STATIC_POINTS;
        }

        return score;
      }, 0);

  return { route, score, index };
}

/**
 * Give a score to all routes and sort them on that
 * @param {object[]} routes
 * @return {object[]}
 */
function rankRoutes(routes) {
  return (
    routes
      .map(rankRoute)
      // If two routes have the exact same score, we go by index instead
      .sort((a, b) =>
        a.score < b.score ? 1 : a.score > b.score ? -1 : a.index - b.index
      )
  );
}

/**
 * Ranks and picks the best route to match. Each segment gets the highest
 * amount of points, then the type of segment gets an additional amount of
 * points where
 *
 *  static > dynamic > splat > root
 *
 * This way we don't have to worry about the order of our routes, let the
 * computers do it.
 *
 * A route looks like this
 *
 *  { path, default, value }
 *
 * And a returned match looks like:
 *
 *  { route, params, uri }
 *
 * @param {object[]} routes
 * @param {string} uri
 * @return {?object}
 */
function pick(routes, uri) {
  let match;
  let default_;

  const [uriPathname] = uri.split("?");
  const uriSegments = segmentize(uriPathname);
  const isRootUri = uriSegments[0] === "";
  const ranked = rankRoutes(routes);

  for (let i = 0, l = ranked.length; i < l; i++) {
    const route = ranked[i].route;
    let missed = false;

    if (route.default) {
      default_ = {
        route,
        params: {},
        uri
      };
      continue;
    }

    const routeSegments = segmentize(route.path);
    const params = {};
    const max = Math.max(uriSegments.length, routeSegments.length);
    let index = 0;

    for (; index < max; index++) {
      const routeSegment = routeSegments[index];
      const uriSegment = uriSegments[index];

      if (routeSegment !== undefined && isSplat(routeSegment)) {
        // Hit a splat, just grab the rest, and return a match
        // uri:   /files/documents/work
        // route: /files/* or /files/*splatname
        const splatName = routeSegment === "*" ? "*" : routeSegment.slice(1);

        params[splatName] = uriSegments
          .slice(index)
          .map(decodeURIComponent)
          .join("/");
        break;
      }

      if (uriSegment === undefined) {
        // URI is shorter than the route, no match
        // uri:   /users
        // route: /users/:userId
        missed = true;
        break;
      }

      let dynamicMatch = paramRe.exec(routeSegment);

      if (dynamicMatch && !isRootUri) {
        const value = decodeURIComponent(uriSegment);
        params[dynamicMatch[1]] = value;
      } else if (routeSegment !== uriSegment) {
        // Current segments don't match, not dynamic, not splat, so no match
        // uri:   /users/123/settings
        // route: /users/:id/profile
        missed = true;
        break;
      }
    }

    if (!missed) {
      match = {
        route,
        params,
        uri: "/" + uriSegments.slice(0, index).join("/")
      };
      break;
    }
  }

  return match || default_ || null;
}

/**
 * Check if the `path` matches the `uri`.
 * @param {string} path
 * @param {string} uri
 * @return {?object}
 */
function match(route, uri) {
  return pick([route], uri);
}

/**
 * Combines the `basepath` and the `path` into one path.
 * @param {string} basepath
 * @param {string} path
 */
function combinePaths(basepath, path) {
  return `${stripSlashes(
    path === "/" ? basepath : `${stripSlashes(basepath)}/${stripSlashes(path)}`
  )}/`;
}

/* node_modules\svelte-routing\src\Router.svelte generated by Svelte v3.50.1 */

const Router = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $location, $$unsubscribe_location;
	let $routes, $$unsubscribe_routes;
	let $base, $$unsubscribe_base;
	let { basepath = "/" } = $$props;
	let { url = null } = $$props;
	const locationContext = getContext(LOCATION);
	const routerContext = getContext(ROUTER);
	const routes = writable([]);
	$$unsubscribe_routes = subscribe(routes, value => $routes = value);
	const activeRoute = writable(null);
	let hasActiveRoute = false; // Used in SSR to synchronously set that a Route is active.

	// If locationContext is not set, this is the topmost Router in the tree.
	// If the `url` prop is given we force the location to it.
	const location = locationContext || writable(url ? { pathname: url } : globalHistory.location);

	$$unsubscribe_location = subscribe(location, value => $location = value);

	// If routerContext is set, the routerBase of the parent Router
	// will be the base for this Router's descendants.
	// If routerContext is not set, the path and resolved uri will both
	// have the value of the basepath prop.
	const base = routerContext
	? routerContext.routerBase
	: writable({ path: basepath, uri: basepath });

	$$unsubscribe_base = subscribe(base, value => $base = value);

	const routerBase = derived([base, activeRoute], ([base, activeRoute]) => {
		// If there is no activeRoute, the routerBase will be identical to the base.
		if (activeRoute === null) {
			return base;
		}

		const { path: basepath } = base;
		const { route, uri } = activeRoute;

		// Remove the potential /* or /*splatname from
		// the end of the child Routes relative paths.
		const path = route.default
		? basepath
		: route.path.replace(/\*.*$/, "");

		return { path, uri };
	});

	function registerRoute(route) {
		const { path: basepath } = $base;
		let { path } = route;

		// We store the original path in the _path property so we can reuse
		// it when the basepath changes. The only thing that matters is that
		// the route reference is intact, so mutation is fine.
		route._path = path;

		route.path = combinePaths(basepath, path);

		if (typeof window === "undefined") {
			// In SSR we should set the activeRoute immediately if it is a match.
			// If there are more Routes being registered after a match is found,
			// we just skip them.
			if (hasActiveRoute) {
				return;
			}

			const matchingRoute = match(route, $location.pathname);

			if (matchingRoute) {
				activeRoute.set(matchingRoute);
				hasActiveRoute = true;
			}
		} else {
			routes.update(rs => {
				rs.push(route);
				return rs;
			});
		}
	}

	function unregisterRoute(route) {
		routes.update(rs => {
			const index = rs.indexOf(route);
			rs.splice(index, 1);
			return rs;
		});
	}

	if (!locationContext) {
		// The topmost Router in the tree is responsible for updating
		// the location store and supplying it through context.
		onMount(() => {
			const unlisten = globalHistory.listen(history => {
				location.set(history.location);
			});

			return unlisten;
		});

		setContext(LOCATION, location);
	}

	setContext(ROUTER, {
		activeRoute,
		base,
		routerBase,
		registerRoute,
		unregisterRoute
	});

	if ($$props.basepath === void 0 && $$bindings.basepath && basepath !== void 0) $$bindings.basepath(basepath);
	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);

	{
		{
			const { path: basepath } = $base;

			routes.update(rs => {
				rs.forEach(r => r.path = combinePaths(basepath, r._path));
				return rs;
			});
		}
	}

	{
		{
			const bestMatch = pick($routes, $location.pathname);
			activeRoute.set(bestMatch);
		}
	}

	$$unsubscribe_location();
	$$unsubscribe_routes();
	$$unsubscribe_base();
	return `${slots.default ? slots.default({}) : ``}`;
});

/* node_modules\svelte-routing\src\Route.svelte generated by Svelte v3.50.1 */

const Route = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $activeRoute, $$unsubscribe_activeRoute;
	let $location, $$unsubscribe_location;
	let { path = "" } = $$props;
	let { component = null } = $$props;
	const { registerRoute, unregisterRoute, activeRoute } = getContext(ROUTER);
	$$unsubscribe_activeRoute = subscribe(activeRoute, value => $activeRoute = value);
	const location = getContext(LOCATION);
	$$unsubscribe_location = subscribe(location, value => $location = value);

	const route = {
		path,
		// If no path prop is given, this Route will act as the default Route
		// that is rendered if no other Route in the Router is a match.
		default: path === ""
	};

	let routeParams = {};
	let routeProps = {};
	registerRoute(route);

	// There is no need to unregister Routes in SSR since it will all be
	// thrown away anyway.
	if (typeof window !== "undefined") {
		onDestroy(() => {
			unregisterRoute(route);
		});
	}

	if ($$props.path === void 0 && $$bindings.path && path !== void 0) $$bindings.path(path);
	if ($$props.component === void 0 && $$bindings.component && component !== void 0) $$bindings.component(component);

	{
		if ($activeRoute && $activeRoute.route === route) {
			routeParams = $activeRoute.params;
		}
	}

	{
		{
			const { path, component, ...rest } = $$props;
			routeProps = rest;
		}
	}

	$$unsubscribe_activeRoute();
	$$unsubscribe_location();

	return `${$activeRoute !== null && $activeRoute.route === route
	? `${component !== null
		? `${validate_component(component || missing_component, "svelte:component").$$render($$result, Object.assign({ location: $location }, routeParams, routeProps), {}, {})}`
		: `${slots.default
			? slots.default({ params: routeParams, location: $location })
			: ``}`}`
	: ``}`;
});

/* src\components\HomepageContent.svelte generated by Svelte v3.50.1 */

const css$d = {
	code: ".svelte-akqwwi{box-sizing:border-box;margin:0px;padding:0px;font-family:system-ui}.homepage.svelte-akqwwi{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}.container.svelte-akqwwi{padding:50px 100px;width:fit-content;border-radius:6px;background-color:#fff;box-shadow:0px 4px 0px rgba(0,0,0,0.45);border:2px solid #0f4d92}.iContain.svelte-akqwwi{position:relative;margin:10px;font-family:poppins}.iHeader.svelte-akqwwi{position:absolute;font-size:12px;top:-10px;left:5px;background-color:#fff;border-radius:25px}.iField.svelte-akqwwi{font-size:16px;padding:5px 10px;outline:none}.buttonContain.svelte-akqwwi{padding:10px}.loginButton.svelte-akqwwi{transition:250ms;cursor:pointer;width:100%;font-size:18px;padding:5px 0px;color:#fff;border:none;border-radius:4px;background-color:#0f4d92;box-shadow:0px 2px 0px rgba(0,0,0,0.25)}.loginButton.svelte-akqwwi:hover{background-color:#0072bb;box-shadow:0px 3px 0px rgba(0,0,0,0.45)}.loginButton.svelte-akqwwi:active{box-shadow:0px 0px 0px rgba(0,0,0,0.45);background-color:#000080}",
	map: "{\"version\":3,\"file\":\"HomepageContent.svelte\",\"sources\":[\"HomepageContent.svelte\"],\"sourcesContent\":[\"<script>\\r\\n    let username\\r\\n    let password\\r\\n    const handleUserOnChange =(e)=>{\\r\\n        username = e.target.value\\r\\n    }\\r\\n    const handlePassOnChange = (e)=>{\\r\\n        password = e.target.value\\r\\n    }\\r\\n    const onLogin = () =>{\\r\\n        const url = \\\"http://localhost:8080/authenticate\\\"\\r\\n    fetch(url,{\\r\\n      method: \\\"POST\\\",\\r\\n      body:JSON.stringify({\\r\\n        username:username,\\r\\n        password:password\\r\\n      })\\r\\n    })\\r\\n    .then(response => response.json())\\r\\n    .then(data => {\\r\\n\\t\\tif(data.Code != 403){\\r\\n            sessionStorage.setItem(\\\"JWT\\\",data.Message)\\r\\n            window.location.replace(\\\"/dashboard\\\")\\r\\n        }else{\\r\\n            alert(data.Message)\\r\\n        }\\r\\n    }).catch(error => {\\r\\n      console.log(error);\\r\\n    });\\r\\n    }\\r\\n</script>\\r\\n<main>\\r\\n<div class=\\\"homepage\\\">\\r\\n    <div class=\\\"container\\\">\\r\\n        <div class=\\\"iContain\\\">\\r\\n            <span class=\\\"iHeader\\\">Username: </span>\\r\\n        <input class=\\\"iField\\\" type=\\\"text\\\" name=\\\"username\\\" id=\\\"username\\\" on:change={handleUserOnChange} >\\r\\n\\r\\n        </div>\\r\\n        <div class=\\\"iContain\\\">\\r\\n            <span class=\\\"iHeader\\\">Password: </span>\\r\\n       <input class=\\\"iField\\\" type=\\\"password\\\" name=\\\"password\\\" id=\\\"password\\\" on:change={handlePassOnChange}>\\r\\n\\r\\n        </div>\\r\\n        <div class=\\\"buttonContain\\\">\\r\\n            <button class=\\\"loginButton\\\" id=\\\"login\\\" on:click={onLogin}>Login</button>\\r\\n        </div>\\r\\n    </div>\\r\\n</div>\\r\\n</main>\\r\\n<style>\\r\\n    *{\\r\\n        box-sizing: border-box;\\r\\n        margin: 0px;\\r\\n        padding: 0px;\\r\\n        font-family: system-ui;\\r\\n    }\\r\\n    .homepage{\\r\\n        width: 100vw;\\r\\n        height: 100vh;\\r\\n        display: flex;\\r\\n        align-items: center;\\r\\n        justify-content: center;\\r\\n    }\\r\\n    .container{\\r\\n    padding: 50px 100px;\\r\\n    width:fit-content;\\r\\n    border-radius: 6px;\\r\\n    background-color: #fff;\\r\\n    box-shadow: 0px 4px 0px rgba(0,0,0,0.45);\\r\\n    border: 2px solid #0f4d92;\\r\\n}\\r\\n.iContain{\\r\\n position: relative;\\r\\n margin: 10px;\\r\\n font-family: poppins;\\r\\n}\\r\\n.iHeader{\\r\\n    position: absolute;\\r\\n    font-size: 12px;\\r\\n    top: -10px;\\r\\n    left: 5px;\\r\\n    background-color: #fff;\\r\\n    border-radius: 25px;\\r\\n}\\r\\n.iField{\\r\\n    font-size: 16px;\\r\\n    padding: 5px 10px;\\r\\n    outline: none;\\r\\n}\\r\\n.buttonContain{\\r\\n    padding: 10px;\\r\\n}\\r\\n.loginButton{\\r\\n    transition: 250ms;\\r\\n    cursor: pointer;\\r\\n    width: 100%;\\r\\n    font-size: 18px;\\r\\n    padding: 5px 0px;\\r\\n    color: #fff;\\r\\n    border: none;\\r\\n    border-radius: 4px;\\r\\n    background-color: #0f4d92;\\r\\n    box-shadow: 0px 2px 0px rgba(0,0,0,0.25);\\r\\n}\\r\\n.loginButton:hover{\\r\\n    background-color: #0072bb;\\r\\n    box-shadow: 0px 3px 0px rgba(0,0,0,0.45);\\r\\n\\r\\n}\\r\\n.loginButton:active{\\r\\n    box-shadow: 0px 0px 0px rgba(0,0,0,0.45);\\r\\n    background-color: #000080;\\r\\n}\\r\\n</style>\"],\"names\":[],\"mappings\":\"AAmDI,cAAC,CAAC,AACE,UAAU,CAAE,UAAU,CACtB,MAAM,CAAE,GAAG,CACX,OAAO,CAAE,GAAG,CACZ,WAAW,CAAE,SAAS,AAC1B,CAAC,AACD,uBAAS,CAAC,AACN,KAAK,CAAE,KAAK,CACZ,MAAM,CAAE,KAAK,CACb,OAAO,CAAE,IAAI,CACb,WAAW,CAAE,MAAM,CACnB,eAAe,CAAE,MAAM,AAC3B,CAAC,AACD,wBAAU,CAAC,AACX,OAAO,CAAE,IAAI,CAAC,KAAK,CACnB,MAAM,WAAW,CACjB,aAAa,CAAE,GAAG,CAClB,gBAAgB,CAAE,IAAI,CACtB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CACxC,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,AAC7B,CAAC,AACD,uBAAS,CAAC,AACT,QAAQ,CAAE,QAAQ,CAClB,MAAM,CAAE,IAAI,CACZ,WAAW,CAAE,OAAO,AACrB,CAAC,AACD,sBAAQ,CAAC,AACL,QAAQ,CAAE,QAAQ,CAClB,SAAS,CAAE,IAAI,CACf,GAAG,CAAE,KAAK,CACV,IAAI,CAAE,GAAG,CACT,gBAAgB,CAAE,IAAI,CACtB,aAAa,CAAE,IAAI,AACvB,CAAC,AACD,qBAAO,CAAC,AACJ,SAAS,CAAE,IAAI,CACf,OAAO,CAAE,GAAG,CAAC,IAAI,CACjB,OAAO,CAAE,IAAI,AACjB,CAAC,AACD,4BAAc,CAAC,AACX,OAAO,CAAE,IAAI,AACjB,CAAC,AACD,0BAAY,CAAC,AACT,UAAU,CAAE,KAAK,CACjB,MAAM,CAAE,OAAO,CACf,KAAK,CAAE,IAAI,CACX,SAAS,CAAE,IAAI,CACf,OAAO,CAAE,GAAG,CAAC,GAAG,CAChB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,aAAa,CAAE,GAAG,CAClB,gBAAgB,CAAE,OAAO,CACzB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAC5C,CAAC,AACD,0BAAY,MAAM,CAAC,AACf,gBAAgB,CAAE,OAAO,CACzB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAE5C,CAAC,AACD,0BAAY,OAAO,CAAC,AAChB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CACxC,gBAAgB,CAAE,OAAO,AAC7B,CAAC\"}"
};

const HomepageContent = create_ssr_component(($$result, $$props, $$bindings, slots) => {

	$$result.css.add(css$d);

	return `<main class="${"svelte-akqwwi"}"><div class="${"homepage svelte-akqwwi"}"><div class="${"container svelte-akqwwi"}"><div class="${"iContain svelte-akqwwi"}"><span class="${"iHeader svelte-akqwwi"}">Username: </span>
        <input class="${"iField svelte-akqwwi"}" type="${"text"}" name="${"username"}" id="${"username"}"></div>
        <div class="${"iContain svelte-akqwwi"}"><span class="${"iHeader svelte-akqwwi"}">Password: </span>
       <input class="${"iField svelte-akqwwi"}" type="${"password"}" name="${"password"}" id="${"password"}"></div>
        <div class="${"buttonContain svelte-akqwwi"}"><button class="${"loginButton svelte-akqwwi"}" id="${"login"}">Login</button></div></div></div>
</main>`;
});

/* src\page\Homepage.svelte generated by Svelte v3.50.1 */

const Homepage = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<main>${validate_component(HomepageContent, "HomepageContent").$$render($$result, {}, {}, {})}</main>`;
});

/* src\utils\ProtectedRoutes.svelte generated by Svelte v3.50.1 */

const ProtectedRoutes = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { path } = $$props;
	let { component } = $$props;
	let isLoggedIn = false;
	let loaded = false;

	onMount(() => {
		let token = sessionStorage.getItem("JWT");

		if (token != undefined || token != null) {
			const url = "http://localhost:8080/authorize";

			fetch(url, {
				method: "POST",
				body: JSON.stringify({ token, group: "" })
			}).then(response => response.json()).then(data => {
				if (data.Code == 200) {
					isLoggedIn = true;
					loaded = true;
				} else {
					isLoggedIn = false;
					loaded = true;
					navigate("/");
				}
			}).catch(error => {
				console.log(error);
				isLoggedIn = false;
				loaded = true;
				navigate("/");
			});
		} else {
			loaded = true;
			navigate("/");
		}
	});

	if ($$props.path === void 0 && $$bindings.path && path !== void 0) $$bindings.path(path);
	if ($$props.component === void 0 && $$bindings.component && component !== void 0) $$bindings.component(component);

	return `${isLoggedIn && loaded
	? `${validate_component(Route, "Route").$$render($$result, { path, component }, {}, {})}`
	: `${!isLoggedIn && loaded
		? `${validate_component(Route, "Route").$$render($$result, { component: Homepage }, {}, {})}`
		: ``}`}`;
});

/* src\components\Navbar.svelte generated by Svelte v3.50.1 */

const css$c = {
	code: ".navbar.svelte-q9ubpp.svelte-q9ubpp{overflow:hidden;font-family:sans-serif;background-color:var(--main-color);border-bottom:2px solid var(--border-light-color);max-width:100vw;max-height:10vh}.navbar.svelte-q9ubpp a.svelte-q9ubpp{transition:250ms;float:left;font-size:16px;color:var(--font-light-color);text-align:center;padding:14px 16px;text-decoration:none}.dropdown.svelte-q9ubpp.svelte-q9ubpp{float:left;overflow:hidden}.dropdown.svelte-q9ubpp .dropbtn.svelte-q9ubpp{transition:250ms;font-size:16px;border:none;outline:none;color:var(--font-light-color);padding:14px 16px;background-color:inherit;font-family:inherit;margin:0}.navbar.svelte-q9ubpp a.svelte-q9ubpp:hover,.dropdown.svelte-q9ubpp:hover .dropbtn.svelte-q9ubpp{background-color:var(--main-light-color);cursor:pointer}.navbar.svelte-q9ubpp a.svelte-q9ubpp:active{background-color:var(--main-dark-color)}.dropdown-content.svelte-q9ubpp.svelte-q9ubpp{border-radius:2px;cursor:pointer;display:none;position:absolute;background-color:var(--background-light-color);min-width:160px;box-shadow:0px 4px 10px rgba(0,0,0,0.45);z-index:1}.dropdown.svelte-q9ubpp:hover .dropdown-content.svelte-q9ubpp{display:flex;flex-direction:column}.topnav-right.svelte-q9ubpp.svelte-q9ubpp{float:right}.dropItem.svelte-q9ubpp.svelte-q9ubpp{transition:250ms;padding:5px 10px;font-family:sans-serif;outline:none;cursor:pointer;border:none;border-bottom:1px solid var(--border-light-color);background-color:var(--main-color);color:var(--font-light-color)}.dropItem.svelte-q9ubpp.svelte-q9ubpp:hover{background-color:var(--main-light-color)}.dropItem.svelte-q9ubpp.svelte-q9ubpp:active{background-color:var(--main-dark-color)}",
	map: "{\"version\":3,\"file\":\"Navbar.svelte\",\"sources\":[\"Navbar.svelte\"],\"sourcesContent\":[\"<script>\\r\\nimport {navigate} from \\\"svelte-routing\\\"\\r\\nimport { onMount } from \\\"svelte\\\"\\r\\n\\r\\nfunction logout(){\\r\\n  sessionStorage.clear()\\r\\n  navigate(\\\"/\\\")\\r\\n}\\r\\n\\r\\nlet isAdmin = \\\"false\\\"\\r\\nonMount(()=>{\\r\\n  let token = sessionStorage.getItem(\\\"JWT\\\")\\r\\n  if(token != undefined || token != null){\\r\\n    const url = \\\"http://localhost:8080/authorize\\\"\\r\\n      fetch(url,{\\r\\n      method: \\\"POST\\\",\\r\\n      body:JSON.stringify({\\r\\n        token:token,\\r\\n        group:\\\"admin\\\"\\r\\n      })\\r\\n    })\\r\\n    .then(response => response.json())\\r\\n    .then(data => {\\r\\n      isAdmin = data.Message\\r\\n    }).catch(error => {\\r\\n      console.log(error);\\r\\n    });\\r\\n  }else{\\r\\n    isAdmin = \\\"false\\\"\\r\\n  }\\r\\n  \\r\\n}\\r\\n)\\r\\n\\r\\n</script>\\r\\n\\r\\n<style>\\r\\n.navbar {\\r\\n  overflow: hidden;\\r\\n  font-family: sans-serif;\\r\\n  background-color: var(--main-color);\\r\\n  border-bottom: 2px solid var(--border-light-color);\\r\\n  max-width: 100vw;\\r\\n  max-height: 10vh;\\r\\n}\\r\\n\\r\\n.navbar a {\\r\\n  transition: 250ms;\\r\\n  float: left;\\r\\n  font-size: 16px;\\r\\n  color: var(--font-light-color);\\r\\n  text-align: center;\\r\\n  padding: 14px 16px;\\r\\n  text-decoration: none;\\r\\n}\\r\\n\\r\\n.dropdown {\\r\\n  float: left;\\r\\n  overflow: hidden;\\r\\n}\\r\\n\\r\\n.dropdown .dropbtn {\\r\\n  transition:250ms;\\r\\n  font-size: 16px;  \\r\\n  border: none;\\r\\n  outline: none;\\r\\n  color: var(--font-light-color);\\r\\n  padding: 14px 16px;\\r\\n  background-color: inherit;\\r\\n  font-family: inherit;\\r\\n  margin: 0;\\r\\n}\\r\\n\\r\\n.navbar a:hover, .dropdown:hover .dropbtn {\\r\\n  background-color: var(--main-light-color);\\r\\n  cursor: pointer;\\r\\n}\\r\\n.navbar a:active{\\r\\n  background-color: var(--main-dark-color);\\r\\n}\\r\\n.dropdown-content {\\r\\n  border-radius: 2px;\\r\\n  cursor: pointer;\\r\\n  display: none;\\r\\n  position: absolute;\\r\\n  background-color: var(--background-light-color);\\r\\n  min-width: 160px;\\r\\n  box-shadow: 0px 4px 10px rgba(0,0,0,0.45);\\r\\n  z-index: 1;\\r\\n}\\r\\n\\r\\n.dropdown:hover .dropdown-content {\\r\\n  display: flex;\\r\\n  flex-direction: column;\\r\\n}\\r\\n.topnav-right {\\r\\n  float: right;\\r\\n}\\r\\n.dropItem{\\r\\n  transition: 250ms;\\r\\n  padding:5px 10px;\\r\\n  font-family: sans-serif;\\r\\n  outline: none;\\r\\n  cursor: pointer;\\r\\n  border: none;\\r\\n  border-bottom: 1px solid var(--border-light-color);\\r\\n  background-color: var(--main-color);\\r\\n  color: var(--font-light-color);\\r\\n}\\r\\n.dropItem:hover{\\r\\n  background-color: var(--main-light-color);\\r\\n}\\r\\n.dropItem:active{\\r\\n  background-color: var(--main-dark-color); \\r\\n}\\r\\n</style>\\r\\n\\r\\n<nav class=\\\"navbar\\\">\\r\\n  <a href={null} on:click={()=>{navigate('/dashboard')}}>Dashboard</a>\\r\\n  <a href={null} on:click={()=>{navigate('/profile')}}>Profile</a>\\r\\n  {#if isAdmin === \\\"true\\\"}\\r\\n  <div class=\\\"dropdown\\\">\\r\\n    <button class=\\\"dropbtn\\\">Admin\\r\\n      <i class=\\\"fa fa-caret-down\\\"></i>\\r\\n    </button>\\r\\n    <div class=\\\"dropdown-content\\\">\\r\\n      <a href={null} class=\\\"dropItem\\\" on:click={()=>{navigate('/userManagement')}}>User Management</a>\\r\\n      <a href={null} class=\\\"dropItem\\\" on:click={()=>{navigate('/groupManagement')}}>Group Management</a>\\r\\n    </div>\\r\\n  </div>\\r\\n  {/if}\\r\\n  <div class=\\\"topnav-right\\\">\\r\\n    <a href={null} on:click=\\\"{logout}\\\" >Logout</a>\\r\\n  </div>\\r\\n</nav>\"],\"names\":[],\"mappings\":\"AAqCA,OAAO,4BAAC,CAAC,AACP,QAAQ,CAAE,MAAM,CAChB,WAAW,CAAE,UAAU,CACvB,gBAAgB,CAAE,IAAI,YAAY,CAAC,CACnC,aAAa,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,oBAAoB,CAAC,CAClD,SAAS,CAAE,KAAK,CAChB,UAAU,CAAE,IAAI,AAClB,CAAC,AAED,qBAAO,CAAC,CAAC,cAAC,CAAC,AACT,UAAU,CAAE,KAAK,CACjB,KAAK,CAAE,IAAI,CACX,SAAS,CAAE,IAAI,CACf,KAAK,CAAE,IAAI,kBAAkB,CAAC,CAC9B,UAAU,CAAE,MAAM,CAClB,OAAO,CAAE,IAAI,CAAC,IAAI,CAClB,eAAe,CAAE,IAAI,AACvB,CAAC,AAED,SAAS,4BAAC,CAAC,AACT,KAAK,CAAE,IAAI,CACX,QAAQ,CAAE,MAAM,AAClB,CAAC,AAED,uBAAS,CAAC,QAAQ,cAAC,CAAC,AAClB,WAAW,KAAK,CAChB,SAAS,CAAE,IAAI,CACf,MAAM,CAAE,IAAI,CACZ,OAAO,CAAE,IAAI,CACb,KAAK,CAAE,IAAI,kBAAkB,CAAC,CAC9B,OAAO,CAAE,IAAI,CAAC,IAAI,CAClB,gBAAgB,CAAE,OAAO,CACzB,WAAW,CAAE,OAAO,CACpB,MAAM,CAAE,CAAC,AACX,CAAC,AAED,qBAAO,CAAC,eAAC,MAAM,CAAE,uBAAS,MAAM,CAAC,QAAQ,cAAC,CAAC,AACzC,gBAAgB,CAAE,IAAI,kBAAkB,CAAC,CACzC,MAAM,CAAE,OAAO,AACjB,CAAC,AACD,qBAAO,CAAC,eAAC,OAAO,CAAC,AACf,gBAAgB,CAAE,IAAI,iBAAiB,CAAC,AAC1C,CAAC,AACD,iBAAiB,4BAAC,CAAC,AACjB,aAAa,CAAE,GAAG,CAClB,MAAM,CAAE,OAAO,CACf,OAAO,CAAE,IAAI,CACb,QAAQ,CAAE,QAAQ,CAClB,gBAAgB,CAAE,IAAI,wBAAwB,CAAC,CAC/C,SAAS,CAAE,KAAK,CAChB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,IAAI,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CACzC,OAAO,CAAE,CAAC,AACZ,CAAC,AAED,uBAAS,MAAM,CAAC,iBAAiB,cAAC,CAAC,AACjC,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,AACxB,CAAC,AACD,aAAa,4BAAC,CAAC,AACb,KAAK,CAAE,KAAK,AACd,CAAC,AACD,qCAAS,CAAC,AACR,UAAU,CAAE,KAAK,CACjB,QAAQ,GAAG,CAAC,IAAI,CAChB,WAAW,CAAE,UAAU,CACvB,OAAO,CAAE,IAAI,CACb,MAAM,CAAE,OAAO,CACf,MAAM,CAAE,IAAI,CACZ,aAAa,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,oBAAoB,CAAC,CAClD,gBAAgB,CAAE,IAAI,YAAY,CAAC,CACnC,KAAK,CAAE,IAAI,kBAAkB,CAAC,AAChC,CAAC,AACD,qCAAS,MAAM,CAAC,AACd,gBAAgB,CAAE,IAAI,kBAAkB,CAAC,AAC3C,CAAC,AACD,qCAAS,OAAO,CAAC,AACf,gBAAgB,CAAE,IAAI,iBAAiB,CAAC,AAC1C,CAAC\"}"
};

const Navbar = create_ssr_component(($$result, $$props, $$bindings, slots) => {

	let isAdmin = "false";

	onMount(() => {
		let token = sessionStorage.getItem("JWT");

		if (token != undefined || token != null) {
			const url = "http://localhost:8080/authorize";

			fetch(url, {
				method: "POST",
				body: JSON.stringify({ token, group: "admin" })
			}).then(response => response.json()).then(data => {
				isAdmin = data.Message;
			}).catch(error => {
				console.log(error);
			});
		} else {
			isAdmin = "false";
		}
	});

	$$result.css.add(css$c);

	return `<nav class="${"navbar svelte-q9ubpp"}"><a${add_attribute("href", null, 0)} class="${"svelte-q9ubpp"}">Dashboard</a>
  <a${add_attribute("href", null, 0)} class="${"svelte-q9ubpp"}">Profile</a>
  ${isAdmin === "true"
	? `<div class="${"dropdown svelte-q9ubpp"}"><button class="${"dropbtn svelte-q9ubpp"}">Admin
      <i class="${"fa fa-caret-down"}"></i></button>
    <div class="${"dropdown-content svelte-q9ubpp"}"><a${add_attribute("href", null, 0)} class="${"dropItem svelte-q9ubpp"}">User Management</a>
      <a${add_attribute("href", null, 0)} class="${"dropItem svelte-q9ubpp"}">Group Management</a></div></div>`
	: ``}
  <div class="${"topnav-right svelte-q9ubpp"}"><a${add_attribute("href", null, 0)} class="${"svelte-q9ubpp"}">Logout</a></div></nav>`;
});

/* src\UI\Button.svelte generated by Svelte v3.50.1 */

const css$b = {
	code: "button.svelte-1qf77kj{font:sans-serif;border:1px solid var(--main-color);background:var(--main-color);padding:0.5rem 1rem;color:var(--font-light-color);border-radius:5px;box-shadow:1px 1px 3px rgba(0, 0, 0, 0.26);cursor:pointer;text-decoration:none}button.svelte-1qf77kj:focus{outline:none}button.svelte-1qf77kj:hover,button.svelte-1qf77kj:active{background:var(--main-light-color);border-color:var(--main-light-color);box-shadow:1px 1px 8px rgba(77, 51, 51, 0.26)}button.svelte-1qf77kj:disabled,button.svelte-1qf77kj:disabled:hover,button.svelte-1qf77kj:disabled:active{background:#ccc;border-color:#ccc;color:#959595;box-shadow:none;cursor:not-allowed}.sm.svelte-1qf77kj{padding:0.2rem 0.4rem;font-size:0.8rem}.outline.svelte-1qf77kj{background:transparent;color:var(--main-color);box-shadow:none}.outline.svelte-1qf77kj:hover,.outline.svelte-1qf77kj:active{background:var(--main-color);box-shadow:none;color:var(--font-light-color)}.outline.svelte-1qf77kj:disabled,.outline.svelte-1qf77kj:disabled:hover,.outline.svelte-1qf77kj:disabled:active{background:transparent;color:#ccc}.danger.svelte-1qf77kj{background:var(--danger-color);color:var(--font-light-color);box-shadow:none;border:1px solid var(--danger-color)}.danger.svelte-1qf77kj:hover,.danger.svelte-1qf77kj:active{background:var(--danger-color);opacity:0.8;box-shadow:none;color:var(--font-light-color);border:1px solid var(--danger-color)}.danger.svelte-1qf77kj:disabled,.danger.svelte-1qf77kj:disabled:hover,.danger.svelte-1qf77kj:disabled:active{background:transparent;color:#ccc}",
	map: "{\"version\":3,\"file\":\"Button.svelte\",\"sources\":[\"Button.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  export let mode; //mode options = \\\"outline\\\", \\\"danger\\\"\\r\\n  export let size; //size options= \\\"sm\\\"\\r\\n  export let disabled = false;\\r\\n  export let type = \\\"button\\\";\\r\\n  export let id;\\r\\n</script>\\r\\n\\r\\n<button id={id} class={`${mode} ${size}`} type={type} on:click on:submit disabled = {disabled}>\\r\\n  <slot />\\r\\n</button>\\r\\n\\r\\n<style>\\r\\n  button {\\r\\n    font: sans-serif;\\r\\n    border: 1px solid var(--main-color);\\r\\n    background: var(--main-color);\\r\\n    padding: 0.5rem 1rem;\\r\\n    color: var(--font-light-color);\\r\\n    border-radius: 5px;\\r\\n    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);\\r\\n    cursor: pointer;\\r\\n    text-decoration: none;\\r\\n  }\\r\\n\\r\\n  button:focus {\\r\\n    outline: none;\\r\\n  }\\r\\n\\r\\n  button:hover,\\r\\n  button:active {\\r\\n    background: var(--main-light-color);\\r\\n    border-color: var(--main-light-color);\\r\\n    box-shadow: 1px 1px 8px rgba(77, 51, 51, 0.26);\\r\\n  }\\r\\n\\r\\n  button:disabled,\\r\\n  button:disabled:hover,\\r\\n  button:disabled:active {\\r\\n    background: #ccc;\\r\\n    border-color: #ccc;\\r\\n    color: #959595;\\r\\n    box-shadow: none;\\r\\n    cursor: not-allowed;\\r\\n  }\\r\\n\\r\\n  .sm {\\r\\n    padding: 0.2rem 0.4rem;\\r\\n    font-size: 0.8rem;\\r\\n  }\\r\\n\\r\\n  .outline {\\r\\n    background: transparent;\\r\\n    color: var(--main-color);\\r\\n    box-shadow: none;\\r\\n  }\\r\\n\\r\\n  .outline:hover,\\r\\n  .outline:active {\\r\\n    background: var(--main-color);\\r\\n    box-shadow: none;\\r\\n    color: var(--font-light-color);\\r\\n  }\\r\\n\\r\\n  .outline:disabled,\\r\\n  .outline:disabled:hover,\\r\\n  .outline:disabled:active {\\r\\n    background: transparent;\\r\\n    color: #ccc;\\r\\n  }\\r\\n\\r\\n  .danger {\\r\\n    background: var(--danger-color);\\r\\n    color: var(--font-light-color);\\r\\n    box-shadow: none;\\r\\n    border: 1px solid var(--danger-color);\\r\\n  }\\r\\n\\r\\n  .danger:hover,\\r\\n  .danger:active {\\r\\n    background: var(--danger-color);\\r\\n    opacity: 0.8;\\r\\n    box-shadow: none;\\r\\n    color: var(--font-light-color);\\r\\n    border: 1px solid var(--danger-color);\\r\\n  }\\r\\n\\r\\n  .danger:disabled,\\r\\n  .danger:disabled:hover,\\r\\n  .danger:disabled:active {\\r\\n    background: transparent;\\r\\n    color: #ccc;\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAaE,MAAM,eAAC,CAAC,AACN,IAAI,CAAE,UAAU,CAChB,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,YAAY,CAAC,CACnC,UAAU,CAAE,IAAI,YAAY,CAAC,CAC7B,OAAO,CAAE,MAAM,CAAC,IAAI,CACpB,KAAK,CAAE,IAAI,kBAAkB,CAAC,CAC9B,aAAa,CAAE,GAAG,CAClB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAC3C,MAAM,CAAE,OAAO,CACf,eAAe,CAAE,IAAI,AACvB,CAAC,AAED,qBAAM,MAAM,AAAC,CAAC,AACZ,OAAO,CAAE,IAAI,AACf,CAAC,AAED,qBAAM,MAAM,CACZ,qBAAM,OAAO,AAAC,CAAC,AACb,UAAU,CAAE,IAAI,kBAAkB,CAAC,CACnC,YAAY,CAAE,IAAI,kBAAkB,CAAC,CACrC,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,EAAE,CAAC,CAAC,EAAE,CAAC,CAAC,EAAE,CAAC,CAAC,IAAI,CAAC,AAChD,CAAC,AAED,qBAAM,SAAS,CACf,qBAAM,SAAS,MAAM,CACrB,qBAAM,SAAS,OAAO,AAAC,CAAC,AACtB,UAAU,CAAE,IAAI,CAChB,YAAY,CAAE,IAAI,CAClB,KAAK,CAAE,OAAO,CACd,UAAU,CAAE,IAAI,CAChB,MAAM,CAAE,WAAW,AACrB,CAAC,AAED,GAAG,eAAC,CAAC,AACH,OAAO,CAAE,MAAM,CAAC,MAAM,CACtB,SAAS,CAAE,MAAM,AACnB,CAAC,AAED,QAAQ,eAAC,CAAC,AACR,UAAU,CAAE,WAAW,CACvB,KAAK,CAAE,IAAI,YAAY,CAAC,CACxB,UAAU,CAAE,IAAI,AAClB,CAAC,AAED,uBAAQ,MAAM,CACd,uBAAQ,OAAO,AAAC,CAAC,AACf,UAAU,CAAE,IAAI,YAAY,CAAC,CAC7B,UAAU,CAAE,IAAI,CAChB,KAAK,CAAE,IAAI,kBAAkB,CAAC,AAChC,CAAC,AAED,uBAAQ,SAAS,CACjB,uBAAQ,SAAS,MAAM,CACvB,uBAAQ,SAAS,OAAO,AAAC,CAAC,AACxB,UAAU,CAAE,WAAW,CACvB,KAAK,CAAE,IAAI,AACb,CAAC,AAED,OAAO,eAAC,CAAC,AACP,UAAU,CAAE,IAAI,cAAc,CAAC,CAC/B,KAAK,CAAE,IAAI,kBAAkB,CAAC,CAC9B,UAAU,CAAE,IAAI,CAChB,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,cAAc,CAAC,AACvC,CAAC,AAED,sBAAO,MAAM,CACb,sBAAO,OAAO,AAAC,CAAC,AACd,UAAU,CAAE,IAAI,cAAc,CAAC,CAC/B,OAAO,CAAE,GAAG,CACZ,UAAU,CAAE,IAAI,CAChB,KAAK,CAAE,IAAI,kBAAkB,CAAC,CAC9B,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,cAAc,CAAC,AACvC,CAAC,AAED,sBAAO,SAAS,CAChB,sBAAO,SAAS,MAAM,CACtB,sBAAO,SAAS,OAAO,AAAC,CAAC,AACvB,UAAU,CAAE,WAAW,CACvB,KAAK,CAAE,IAAI,AACb,CAAC\"}"
};

const Button = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { mode } = $$props;
	let { size } = $$props;
	let { disabled = false } = $$props;
	let { type = "button" } = $$props;
	let { id } = $$props;
	if ($$props.mode === void 0 && $$bindings.mode && mode !== void 0) $$bindings.mode(mode);
	if ($$props.size === void 0 && $$bindings.size && size !== void 0) $$bindings.size(size);
	if ($$props.disabled === void 0 && $$bindings.disabled && disabled !== void 0) $$bindings.disabled(disabled);
	if ($$props.type === void 0 && $$bindings.type && type !== void 0) $$bindings.type(type);
	if ($$props.id === void 0 && $$bindings.id && id !== void 0) $$bindings.id(id);
	$$result.css.add(css$b);

	return `<button${add_attribute("id", id, 0)} class="${escape(null_to_empty(`${mode} ${size}`), true) + " svelte-1qf77kj"}"${add_attribute("type", type, 0)} ${disabled ? "disabled" : ""}>${slots.default ? slots.default({}) : ``}
</button>`;
});

/* src\UI\Modal.svelte generated by Svelte v3.50.1 */

const css$a = {
	code: ".modal-backdrop.svelte-12aup7c{position:fixed;top:0;left:0;width:100%;height:100vh;background:rgba(0, 0, 0, 0.75);z-index:10}.modal.svelte-12aup7c{position:fixed;top:10vh;left:10%;width:80%;background:white;border-radius:5px;z-index:100;box-shadow:0 2px 8px rgba(0, 0, 0, 0.26)}.modal-title.svelte-12aup7c{display:flex;justify-content:space-between;border-bottom:1px solid var(--border-light-color)}.close-btn.svelte-12aup7c{cursor:pointer;margin:1rem;font-weight:bold}h3.svelte-12aup7c{padding:1rem;margin:0;font-family:\"Roboto Slab\", sans-serif}.content.svelte-12aup7c{padding:1rem}@media(min-width: 768px){.modal.svelte-12aup7c{width:40rem;left:calc(50% - 20rem)}}",
	map: "{\"version\":3,\"file\":\"Modal.svelte\",\"sources\":[\"Modal.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import { createEventDispatcher } from \\\"svelte\\\";\\r\\n\\r\\n  export let title;\\r\\n\\r\\n  const dispatch = createEventDispatcher();\\r\\n\\r\\n  function closeModal() {\\r\\n    dispatch(\\\"close\\\");\\r\\n  }\\r\\n\\r\\n  window.onkeydown = (e) => { if(e.key === \\\"Escape\\\") dispatch(\\\"close\\\") }\\r\\n</script>\\r\\n\\r\\n<div class=\\\"modal-backdrop\\\"/>\\r\\n<div class=\\\"modal\\\">\\r\\n  <div class=\\\"modal-title\\\">\\r\\n    <h3>{title}</h3>\\r\\n    <p class=\\\"close-btn\\\" on:click={closeModal} style=\\\"font-family: sans-serif;\\\">X</p>\\r\\n  </div>\\r\\n\\r\\n  <div class=\\\"content\\\">\\r\\n    <slot />\\r\\n  </div>\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n  .modal-backdrop {\\r\\n    position: fixed;\\r\\n    top: 0;\\r\\n    left: 0;\\r\\n    width: 100%;\\r\\n    height: 100vh;\\r\\n    background: rgba(0, 0, 0, 0.75);\\r\\n    z-index: 10;\\r\\n  }\\r\\n\\r\\n  .modal {\\r\\n    position: fixed;\\r\\n    top: 10vh;\\r\\n    left: 10%;\\r\\n    width: 80%;\\r\\n    /* max-height: 80vh; */\\r\\n    background: white;\\r\\n    border-radius: 5px;\\r\\n    z-index: 100;\\r\\n    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.26);\\r\\n    /* overflow: scroll; */\\r\\n  }\\r\\n\\r\\n  .modal-title {\\r\\n    display: flex;\\r\\n    justify-content: space-between;\\r\\n    border-bottom: 1px solid var(--border-light-color);\\r\\n  }\\r\\n\\r\\n  .close-btn {\\r\\n    cursor: pointer;\\r\\n    margin: 1rem;\\r\\n    font-weight: bold;\\r\\n  }\\r\\n\\r\\n  h3 {\\r\\n    padding: 1rem;\\r\\n    margin: 0;\\r\\n    font-family: \\\"Roboto Slab\\\", sans-serif;\\r\\n  }\\r\\n\\r\\n  .content {\\r\\n    padding: 1rem;\\r\\n  }\\r\\n\\r\\n  @media (min-width: 768px) {\\r\\n    .modal {\\r\\n      width: 40rem;\\r\\n      left: calc(50% - 20rem);\\r\\n    }\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AA2BE,eAAe,eAAC,CAAC,AACf,QAAQ,CAAE,KAAK,CACf,GAAG,CAAE,CAAC,CACN,IAAI,CAAE,CAAC,CACP,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,KAAK,CACb,UAAU,CAAE,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAC/B,OAAO,CAAE,EAAE,AACb,CAAC,AAED,MAAM,eAAC,CAAC,AACN,QAAQ,CAAE,KAAK,CACf,GAAG,CAAE,IAAI,CACT,IAAI,CAAE,GAAG,CACT,KAAK,CAAE,GAAG,CAEV,UAAU,CAAE,KAAK,CACjB,aAAa,CAAE,GAAG,CAClB,OAAO,CAAE,GAAG,CACZ,UAAU,CAAE,CAAC,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAE3C,CAAC,AAED,YAAY,eAAC,CAAC,AACZ,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,aAAa,CAC9B,aAAa,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,oBAAoB,CAAC,AACpD,CAAC,AAED,UAAU,eAAC,CAAC,AACV,MAAM,CAAE,OAAO,CACf,MAAM,CAAE,IAAI,CACZ,WAAW,CAAE,IAAI,AACnB,CAAC,AAED,EAAE,eAAC,CAAC,AACF,OAAO,CAAE,IAAI,CACb,MAAM,CAAE,CAAC,CACT,WAAW,CAAE,aAAa,CAAC,CAAC,UAAU,AACxC,CAAC,AAED,QAAQ,eAAC,CAAC,AACR,OAAO,CAAE,IAAI,AACf,CAAC,AAED,MAAM,AAAC,YAAY,KAAK,CAAC,AAAC,CAAC,AACzB,MAAM,eAAC,CAAC,AACN,KAAK,CAAE,KAAK,CACZ,IAAI,CAAE,KAAK,GAAG,CAAC,CAAC,CAAC,KAAK,CAAC,AACzB,CAAC,AACH,CAAC\"}"
};

const Modal = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { title } = $$props;
	const dispatch = createEventDispatcher();

	window.onkeydown = e => {
		if (e.key === "Escape") dispatch("close");
	};

	if ($$props.title === void 0 && $$bindings.title && title !== void 0) $$bindings.title(title);
	$$result.css.add(css$a);

	return `<div class="${"modal-backdrop svelte-12aup7c"}"></div>
<div class="${"modal svelte-12aup7c"}"><div class="${"modal-title svelte-12aup7c"}"><h3 class="${"svelte-12aup7c"}">${escape(title)}</h3>
    <p class="${"close-btn svelte-12aup7c"}" style="${"font-family: sans-serif;"}">X</p></div>

  <div class="${"content svelte-12aup7c"}">${slots.default ? slots.default({}) : ``}</div>
</div>`;
});

/* src\UI\TextInput.svelte generated by Svelte v3.50.1 */

const css$9 = {
	code: "input.svelte-11idp0,textarea.svelte-11idp0,select.svelte-11idp0{display:block;width:100%;font-family:sans-serif;border:none;border-bottom:2px solid var(--border-light-color);border-radius:3px 3px 0 0;background:white;padding:0.15rem 0.25rem;transition:border-color 0.1s ease-out;font-size:0.9rem}textarea.svelte-11idp0,select.svelte-11idp0{border:2px solid var(--border-light-color)}textarea.svelte-11idp0{font-size:0.8rem;overflow-y:scroll;resize:none;min-height:4rem;max-height:7.5rem}input.svelte-11idp0:focus,textarea.svelte-11idp0:focus,select.svelte-11idp0:focus{border-color:var(--main-dark-color);outline:none}textarea.svelte-11idp0::-webkit-input-placeholder{font-family:sans-serif}label.svelte-11idp0{font:sans-serif;font-weight:bold;display:block;margin-bottom:0.5rem;width:100%}.form-control.svelte-11idp0{padding:0.5rem 0;width:100%;margin:0.25rem 0}.invalid.svelte-11idp0{border-color:var(--danger-color);background:#fde3e3}.error-message.svelte-11idp0{color:var(--danger-color);margin:0.25rem 0}.textarea-resize.svelte-11idp0{resize:vertical}input.svelte-11idp0:disabled{cursor:not-allowed}",
	map: "{\"version\":3,\"file\":\"TextInput.svelte\",\"sources\":[\"TextInput.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  export let controlType = null;\\r\\n  export let id;\\r\\n  export let label;\\r\\n  export let rows = null;\\r\\n  export let resize = false;\\r\\n  export let value = \\\"\\\";\\r\\n  export let type = \\\"text\\\";\\r\\n  export let placeholder = \\\"\\\";\\r\\n  export let valid = true;\\r\\n  export let validityMessage = \\\"\\\";\\r\\n  export let grouplist = [];\\r\\n  export let readonly = false;\\r\\n  export let disable = false;\\r\\n  export let min = \\\"0\\\";\\r\\n\\r\\n  let touched = false;\\r\\n</script>\\r\\n\\r\\n<div class=\\\"form-control\\\">\\r\\n  {#if label}\\r\\n    <label for={id}>{label}</label>\\r\\n  {/if}\\r\\n  {#if controlType === \\\"textarea\\\"}\\r\\n    <textarea\\r\\n      class:invalid={!valid && touched}\\r\\n      class={resize ? \\\"textarea-resize\\\" : \\\"\\\"}\\r\\n      {rows}\\r\\n      {id}\\r\\n      {value}\\r\\n      {placeholder}\\r\\n      {readonly}\\r\\n      disabled={disable}\\r\\n      on:input\\r\\n      on:blur={() => (touched = true)}\\r\\n    />\\r\\n  {/if}\\r\\n\\r\\n  {#if controlType === \\\"select\\\"}\\r\\n    <select\\r\\n      class:invalid={!valid && touched}\\r\\n      {id}\\r\\n      {value}\\r\\n      {placeholder}\\r\\n      {readonly}\\r\\n      on:input\\r\\n      on:blur={() => (touched = true)}\\r\\n    >\\r\\n      {#each grouplist as group}\\r\\n        <option value={group}>\\r\\n          {group}\\r\\n        </option>\\r\\n      {/each}\\r\\n    </select>\\r\\n  {/if}\\r\\n  {#if controlType === null}\\r\\n    <input\\r\\n      disabled={disable}\\r\\n      class:invalid={!valid && touched}\\r\\n      {type}\\r\\n      {id}\\r\\n      {value}\\r\\n      {placeholder}\\r\\n      {readonly}\\r\\n      {min}\\r\\n      on:input\\r\\n      on:blur={() => (touched = true)}\\r\\n    />\\r\\n  {/if}\\r\\n  {#if validityMessage && !valid && touched}\\r\\n    <p class=\\\"error-message\\\">{validityMessage}</p>\\r\\n  {/if}\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n  input,\\r\\n  textarea,\\r\\n  select {\\r\\n    display: block;\\r\\n    width: 100%;\\r\\n    font-family: sans-serif;\\r\\n    border: none;\\r\\n    border-bottom: 2px solid var(--border-light-color);\\r\\n    border-radius: 3px 3px 0 0;\\r\\n    background: white;\\r\\n    padding: 0.15rem 0.25rem;\\r\\n    transition: border-color 0.1s ease-out;\\r\\n    font-size: 0.9rem;\\r\\n  }\\r\\n\\r\\n  textarea,\\r\\n  select {\\r\\n    border: 2px solid var(--border-light-color);\\r\\n  }\\r\\n\\r\\n  textarea {\\r\\n    font-size: 0.8rem;\\r\\n    overflow-y: scroll;\\r\\n    resize: none;\\r\\n    min-height: 4rem;\\r\\n    max-height: 7.5rem;\\r\\n  }\\r\\n\\r\\n  input:focus,\\r\\n  textarea:focus,\\r\\n  select:focus {\\r\\n    border-color: var(--main-dark-color);\\r\\n    outline: none;\\r\\n  }\\r\\n\\r\\n  textarea::-webkit-input-placeholder {\\r\\n    font-family: sans-serif;\\r\\n  }\\r\\n\\r\\n  label {\\r\\n    font: sans-serif;\\r\\n    font-weight: bold;\\r\\n    display: block;\\r\\n    margin-bottom: 0.5rem;\\r\\n    width: 100%;\\r\\n  }\\r\\n\\r\\n  .form-control {\\r\\n    padding: 0.5rem 0;\\r\\n    width: 100%;\\r\\n    margin: 0.25rem 0;\\r\\n  }\\r\\n\\r\\n  .invalid {\\r\\n    border-color: var(--danger-color);\\r\\n    background: #fde3e3;\\r\\n  }\\r\\n\\r\\n  .error-message {\\r\\n    color: var(--danger-color);\\r\\n    margin: 0.25rem 0;\\r\\n  }\\r\\n  .textarea-resize {\\r\\n    resize: vertical;\\r\\n  }\\r\\n  input:disabled {\\r\\n    cursor: not-allowed;\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AA2EE,mBAAK,CACL,sBAAQ,CACR,MAAM,cAAC,CAAC,AACN,OAAO,CAAE,KAAK,CACd,KAAK,CAAE,IAAI,CACX,WAAW,CAAE,UAAU,CACvB,MAAM,CAAE,IAAI,CACZ,aAAa,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,oBAAoB,CAAC,CAClD,aAAa,CAAE,GAAG,CAAC,GAAG,CAAC,CAAC,CAAC,CAAC,CAC1B,UAAU,CAAE,KAAK,CACjB,OAAO,CAAE,OAAO,CAAC,OAAO,CACxB,UAAU,CAAE,YAAY,CAAC,IAAI,CAAC,QAAQ,CACtC,SAAS,CAAE,MAAM,AACnB,CAAC,AAED,sBAAQ,CACR,MAAM,cAAC,CAAC,AACN,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,oBAAoB,CAAC,AAC7C,CAAC,AAED,QAAQ,cAAC,CAAC,AACR,SAAS,CAAE,MAAM,CACjB,UAAU,CAAE,MAAM,CAClB,MAAM,CAAE,IAAI,CACZ,UAAU,CAAE,IAAI,CAChB,UAAU,CAAE,MAAM,AACpB,CAAC,AAED,mBAAK,MAAM,CACX,sBAAQ,MAAM,CACd,oBAAM,MAAM,AAAC,CAAC,AACZ,YAAY,CAAE,IAAI,iBAAiB,CAAC,CACpC,OAAO,CAAE,IAAI,AACf,CAAC,AAED,sBAAQ,2BAA2B,AAAC,CAAC,AACnC,WAAW,CAAE,UAAU,AACzB,CAAC,AAED,KAAK,cAAC,CAAC,AACL,IAAI,CAAE,UAAU,CAChB,WAAW,CAAE,IAAI,CACjB,OAAO,CAAE,KAAK,CACd,aAAa,CAAE,MAAM,CACrB,KAAK,CAAE,IAAI,AACb,CAAC,AAED,aAAa,cAAC,CAAC,AACb,OAAO,CAAE,MAAM,CAAC,CAAC,CACjB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,OAAO,CAAC,CAAC,AACnB,CAAC,AAED,QAAQ,cAAC,CAAC,AACR,YAAY,CAAE,IAAI,cAAc,CAAC,CACjC,UAAU,CAAE,OAAO,AACrB,CAAC,AAED,cAAc,cAAC,CAAC,AACd,KAAK,CAAE,IAAI,cAAc,CAAC,CAC1B,MAAM,CAAE,OAAO,CAAC,CAAC,AACnB,CAAC,AACD,gBAAgB,cAAC,CAAC,AAChB,MAAM,CAAE,QAAQ,AAClB,CAAC,AACD,mBAAK,SAAS,AAAC,CAAC,AACd,MAAM,CAAE,WAAW,AACrB,CAAC\"}"
};

const TextInput = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { controlType = null } = $$props;
	let { id } = $$props;
	let { label } = $$props;
	let { rows = null } = $$props;
	let { resize = false } = $$props;
	let { value = "" } = $$props;
	let { type = "text" } = $$props;
	let { placeholder = "" } = $$props;
	let { valid = true } = $$props;
	let { validityMessage = "" } = $$props;
	let { grouplist = [] } = $$props;
	let { readonly = false } = $$props;
	let { disable = false } = $$props;
	let { min = "0" } = $$props;
	let touched = false;
	if ($$props.controlType === void 0 && $$bindings.controlType && controlType !== void 0) $$bindings.controlType(controlType);
	if ($$props.id === void 0 && $$bindings.id && id !== void 0) $$bindings.id(id);
	if ($$props.label === void 0 && $$bindings.label && label !== void 0) $$bindings.label(label);
	if ($$props.rows === void 0 && $$bindings.rows && rows !== void 0) $$bindings.rows(rows);
	if ($$props.resize === void 0 && $$bindings.resize && resize !== void 0) $$bindings.resize(resize);
	if ($$props.value === void 0 && $$bindings.value && value !== void 0) $$bindings.value(value);
	if ($$props.type === void 0 && $$bindings.type && type !== void 0) $$bindings.type(type);
	if ($$props.placeholder === void 0 && $$bindings.placeholder && placeholder !== void 0) $$bindings.placeholder(placeholder);
	if ($$props.valid === void 0 && $$bindings.valid && valid !== void 0) $$bindings.valid(valid);
	if ($$props.validityMessage === void 0 && $$bindings.validityMessage && validityMessage !== void 0) $$bindings.validityMessage(validityMessage);
	if ($$props.grouplist === void 0 && $$bindings.grouplist && grouplist !== void 0) $$bindings.grouplist(grouplist);
	if ($$props.readonly === void 0 && $$bindings.readonly && readonly !== void 0) $$bindings.readonly(readonly);
	if ($$props.disable === void 0 && $$bindings.disable && disable !== void 0) $$bindings.disable(disable);
	if ($$props.min === void 0 && $$bindings.min && min !== void 0) $$bindings.min(min);
	$$result.css.add(css$9);

	return `<div class="${"form-control svelte-11idp0"}">${label
	? `<label${add_attribute("for", id, 0)} class="${"svelte-11idp0"}">${escape(label)}</label>`
	: ``}
  ${controlType === "textarea"
	? `<textarea class="${[
			escape(null_to_empty(resize ? "textarea-resize" : ""), true) + " svelte-11idp0",
			!valid && touched ? "invalid" : ""
		].join(' ').trim()}"${add_attribute("rows", rows, 0)}${add_attribute("id", id, 0)}${add_attribute("placeholder", placeholder, 0)} ${readonly ? "readonly" : ""} ${disable ? "disabled" : ""}>${escape(value, true)}</textarea>`
	: ``}

  ${controlType === "select"
	? `<select${add_attribute("id", id, 0)}${add_attribute("value", value, 0)}${add_attribute("placeholder", placeholder, 0)} ${readonly ? "readonly" : ""} class="${["svelte-11idp0", !valid && touched ? "invalid" : ""].join(' ').trim()}">${each(grouplist, group => {
			return `<option${add_attribute("value", group, 0)}>${escape(group)}
        </option>`;
		})}</select>`
	: ``}
  ${controlType === null
	? `<input ${disable ? "disabled" : ""}${add_attribute("type", type, 0)}${add_attribute("id", id, 0)}${add_attribute("value", value, 0)}${add_attribute("placeholder", placeholder, 0)} ${readonly ? "readonly" : ""}${add_attribute("min", min, 0)} class="${["svelte-11idp0", !valid && touched ? "invalid" : ""].join(' ').trim()}">`
	: ``}
  ${validityMessage && !valid && touched
	? `<p class="${"error-message svelte-11idp0"}">${escape(validityMessage)}</p>`
	: ``}
</div>`;
});

/* src\UI\TaskForm.svelte generated by Svelte v3.50.1 */

const css$8 = {
	code: ".planSelection.svelte-1enhzbe{position:absolute;display:flex;align-items:center;font-family:sans-serif;top:20px;right:40px;font-weight:600;font-size:14px}.taskDate.svelte-1enhzbe{font-family:sans-serif;font-size:12px;margin-bottom:5px;position:absolute;top:35px}.editSection.svelte-1enhzbe{position:relative}.btn.svelte-1enhzbe{z-index:6;position:absolute;bottom:1rem;right:1.5rem;border-radius:4px;box-shadow:0px 2px 0px rgba(0, 0, 0, 0.45)}.addnotecontainer.svelte-1enhzbe{width:100%;position:relative}.buttonDiv.svelte-1enhzbe{margin-top:10px;display:flex;justify-content:space-between}",
	map: "{\"version\":3,\"file\":\"TaskForm.svelte\",\"sources\":[\"TaskForm.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import Modal from \\\"../UI/Modal.svelte\\\";\\r\\n  import Button from \\\"./Button.svelte\\\";\\r\\n  import { createEventDispatcher } from \\\"svelte\\\";\\r\\n  import TextInput from \\\"./TextInput.svelte\\\";\\r\\n  const dispatch = createEventDispatcher();\\r\\n\\r\\n\\r\\n  export let task;\\r\\n  export let oldTaskNote;\\r\\n  export let show;\\r\\n  // export let plan;\\r\\n  export let filteredplans;\\r\\n  export let group;\\r\\n\\r\\n  let editedDescription;\\r\\n  let addNoteDisable = true;\\r\\n  let diff = false;\\r\\n  let old = task.taskdes;\\r\\n  let newNote = \\\"\\\";\\r\\n  let tasknote = task.tasknote;\\r\\n  let selectedplan = task.taskplan;\\r\\n  const editDesc = (e) => {\\r\\n        editedDescription = e.target.value;\\r\\n        if (e.target.value != old) {\\r\\n        diff = true;\\r\\n        } else {\\r\\n        diff = false;\\r\\n        }\\r\\n    }\\r\\n  \\r\\n    const handleEdit = () =>{\\r\\n        const url = \\\"http://localhost:8080/edittask\\\";\\r\\n        fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n        editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        group: group,\\r\\n        taskid:task.taskid,\\r\\n        taskdes: editedDescription,\\r\\n        field:\\\"task_description\\\",\\r\\n        taskstate:task.taskstate,\\r\\n        olddes:oldTaskNote,\\r\\n        tasknote:task.tasknote,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        diff = false;\\r\\n        dispatch(\\\"update\\\")\\r\\n        document.getElementById(\\\"tasknotes\\\").value=task.tasknote\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  };\\r\\n  const newNoteChange = (e) => {\\r\\n    newNote = e.target.value;\\r\\n    if (newNote.length > 0) {\\r\\n      addNoteDisable = false;\\r\\n    } else {\\r\\n      addNoteDisable = true;\\r\\n    }\\r\\n  };\\r\\n  const addNoteSubmit = () => {\\r\\n    //Junhe -- update added task notes only - no des\\r\\n    const url = \\\"http://localhost:8080/inserttasknote\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n        editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        group: group,\\r\\n        taskid: task.taskid,\\r\\n        taskstate:task.taskstate,\\r\\n        taskdes: task.taskdes,\\r\\n        olddes: task.taskdes,\\r\\n        tasknote:task.tasknote,\\r\\n        addedtasknote:newNote,\\r\\n    }),\\r\\n    }).then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        diff = false;\\r\\n        dispatch(\\\"update\\\")\\r\\n        document.getElementById(\\\"tasknotes\\\").value=task.tasknote\\r\\n        newNote = \\\"\\\"\\r\\n        document.getElementById(\\\"addnotes\\\").value = newNote\\r\\n        addNoteDisable = true\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  };\\r\\n  const handleSelectPlan =(e)=>{\\r\\n    const url = \\\"http://localhost:8080/edittask\\\";\\r\\n        fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n        editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        group: group,\\r\\n        taskid:task.taskid,\\r\\n        taskdes: e.target.value,\\r\\n        field:\\\"task_plan\\\",\\r\\n        taskstate:task.taskstate,\\r\\n        olddes:oldTaskNote,\\r\\n        tasknote:task.tasknote,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        selectedplan = e.target.value;\\r\\n        dispatch(\\\"update\\\")\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  }\\r\\n  const handlePromote = () => {\\r\\n    dispatch(\\\"promote\\\");\\r\\n    //close form\\r\\n    //get new data update dashboard\\r\\n  };\\r\\n  const handleDemote = () => {\\r\\n    dispatch(\\\"demote\\\");\\r\\n    //closeform\\r\\n    //demote api call udpate\\r\\n  };\\r\\n  const handleClose = () => {\\r\\n    dispatch(\\\"close\\\");\\r\\n  };\\r\\n</script>\\r\\n\\r\\n\\r\\n<Modal on:close title={task.taskname}>\\r\\n  <div class=\\\"taskDate\\\">\\r\\n    <p>Created on: {task.createdate}</p>\\r\\n  </div>\\r\\n  {#if task.taskstate == \\\"open\\\"}\\r\\n    <div class=\\\"planSelection\\\">\\r\\n      <p>Plan:</p>\\r\\n        {#if selectedplan == \\\"\\\"}\\r\\n          <select on:change={handleSelectPlan}>\\r\\n            <option value=\\\"\\\" selected=\\\"selected\\\">None</option>\\r\\n            {#each filteredplans as p}\\r\\n              <option value={p}>{p}</option>\\r\\n            {/each}\\r\\n          </select>\\r\\n        {:else}\\r\\n          <select on:change={handleSelectPlan} default={selectedplan}>\\r\\n            <option value=\\\"\\\">None</option>\\r\\n            {#each filteredplans as p}\\r\\n              {#if p == selectedplan}\\r\\n                <option value={p} selected=\\\"selected\\\">{p}</option>\\r\\n              {:else}\\r\\n                <option value={p}>{p}</option>\\r\\n              {/if}\\r\\n            {/each}\\r\\n          </select>\\r\\n        {/if}\\r\\n    </div>\\r\\n  {/if}\\r\\n  <div class=\\\"editSection\\\">\\r\\n    <TextInput\\r\\n      controlType=\\\"textarea\\\"\\r\\n      value={task.taskdes}\\r\\n      on:input={editDesc}\\r\\n      placeholder=\\\"Edit description\\\"\\r\\n      rows={4}\\r\\n      readonly={task.taskstate == \\\"closed\\\"}\\r\\n    />\\r\\n\\r\\n    <div class=\\\"btn\\\">\\r\\n      <Button disabled={!(diff && task.taskstate != \\\"closed\\\")} mode=\\\"outline\\\" on:click={handleEdit}>Edit</Button>\\r\\n    </div>\\r\\n  </div>\\r\\n  <TextInput\\r\\n  id=\\\"tasknotes\\\"\\r\\n    controlType=\\\"textarea\\\"\\r\\n    readonly={true}\\r\\n    rows={5}\\r\\n    resize={true}\\r\\n    value={`Task Notes: ${task.tasknote}`}\\r\\n  />\\r\\n  <div class=\\\"addnotecontainer\\\">\\r\\n    {#if task.taskstate != \\\"closed\\\"}\\r\\n      <TextInput\\r\\n      id=\\\"addnotes\\\"\\r\\n        controlType=\\\"textarea\\\"\\r\\n        placeholder=\\\"Enter new task notes\\\"\\r\\n        rows=\\\"4\\\"\\r\\n        resize={true}\\r\\n        on:input={newNoteChange}\\r\\n      />\\r\\n      <div class=\\\"btn\\\">\\r\\n        <Button on:click={addNoteSubmit} mode=\\\"outline\\\" disabled={addNoteDisable}\\r\\n          >Add Notes</Button\\r\\n        >\\r\\n      </div>\\r\\n    {/if}\\r\\n  </div>\\r\\n  <div class=\\\"buttonDiv\\\">\\r\\n    <Button on:click={handleClose} mode=\\\"danger\\\">Close</Button>\\r\\n    {#if show}\\r\\n    {#if task.taskstate != \\\"closed\\\"}\\r\\n      <div class=\\\"btn-right\\\">\\r\\n        {#if task.taskstate == \\\"doing\\\" || task.taskstate == \\\"done\\\"}\\r\\n          <Button on:click={handleDemote} mode=\\\"danger\\\">Demote</Button>\\r\\n        {/if}\\r\\n        <Button on:click={handlePromote}>Promote</Button>\\r\\n      </div>\\r\\n    {/if}\\r\\n    {/if}\\r\\n  </div>\\r\\n</Modal>\\r\\n\\r\\n<style>\\r\\n  .planSelection {\\r\\n    position: absolute;\\r\\n    display: flex;\\r\\n    align-items: center;\\r\\n    font-family: sans-serif;\\r\\n    top: 20px;\\r\\n    right: 40px;\\r\\n    font-weight: 600;\\r\\n    font-size: 14px;\\r\\n  }\\r\\n  .taskDate {\\r\\n    font-family: sans-serif;\\r\\n    font-size: 12px;\\r\\n    margin-bottom: 5px;\\r\\n    position: absolute;\\r\\n    top: 35px;\\r\\n  }\\r\\n  .editSection {\\r\\n    position: relative;\\r\\n  }\\r\\n  .btn {\\r\\n    z-index: 6;\\r\\n    position: absolute;\\r\\n    bottom: 1rem;\\r\\n    right: 1.5rem;\\r\\n    border-radius: 4px;\\r\\n    box-shadow: 0px 2px 0px rgba(0, 0, 0, 0.45);\\r\\n  }\\r\\n  .addnotecontainer {\\r\\n    width: 100%;\\r\\n    position: relative;\\r\\n  }\\r\\n  .buttonDiv {\\r\\n    margin-top: 10px;\\r\\n    display: flex;\\r\\n    justify-content: space-between;\\r\\n  }\\r\\n  /* @media screen and (max-width: 1280px){\\r\\n    .taskNote{\\r\\n        min-height: 100px;\\r\\n        max-height: 101px;\\r\\n    }\\r\\n    .addNote{\\r\\n        min-height: 150px;\\r\\n        max-height: 200px;\\r\\n    }\\r\\n    .taskDesc{\\r\\n        min-height: 100px;\\r\\n        max-height: 101px;\\r\\n    }\\r\\n} */\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAuNE,cAAc,eAAC,CAAC,AACd,QAAQ,CAAE,QAAQ,CAClB,OAAO,CAAE,IAAI,CACb,WAAW,CAAE,MAAM,CACnB,WAAW,CAAE,UAAU,CACvB,GAAG,CAAE,IAAI,CACT,KAAK,CAAE,IAAI,CACX,WAAW,CAAE,GAAG,CAChB,SAAS,CAAE,IAAI,AACjB,CAAC,AACD,SAAS,eAAC,CAAC,AACT,WAAW,CAAE,UAAU,CACvB,SAAS,CAAE,IAAI,CACf,aAAa,CAAE,GAAG,CAClB,QAAQ,CAAE,QAAQ,CAClB,GAAG,CAAE,IAAI,AACX,CAAC,AACD,YAAY,eAAC,CAAC,AACZ,QAAQ,CAAE,QAAQ,AACpB,CAAC,AACD,IAAI,eAAC,CAAC,AACJ,OAAO,CAAE,CAAC,CACV,QAAQ,CAAE,QAAQ,CAClB,MAAM,CAAE,IAAI,CACZ,KAAK,CAAE,MAAM,CACb,aAAa,CAAE,GAAG,CAClB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAC7C,CAAC,AACD,iBAAiB,eAAC,CAAC,AACjB,KAAK,CAAE,IAAI,CACX,QAAQ,CAAE,QAAQ,AACpB,CAAC,AACD,UAAU,eAAC,CAAC,AACV,UAAU,CAAE,IAAI,CAChB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,aAAa,AAChC,CAAC\"}"
};

const TaskForm = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	createEventDispatcher();
	let { task } = $$props;
	let { oldTaskNote } = $$props;
	let { show } = $$props;
	let { filteredplans } = $$props;
	let { group } = $$props;
	let addNoteDisable = true;
	let diff = false;
	task.taskdes;
	task.tasknote;
	let selectedplan = task.taskplan;

	if ($$props.task === void 0 && $$bindings.task && task !== void 0) $$bindings.task(task);
	if ($$props.oldTaskNote === void 0 && $$bindings.oldTaskNote && oldTaskNote !== void 0) $$bindings.oldTaskNote(oldTaskNote);
	if ($$props.show === void 0 && $$bindings.show && show !== void 0) $$bindings.show(show);
	if ($$props.filteredplans === void 0 && $$bindings.filteredplans && filteredplans !== void 0) $$bindings.filteredplans(filteredplans);
	if ($$props.group === void 0 && $$bindings.group && group !== void 0) $$bindings.group(group);
	$$result.css.add(css$8);

	return `${validate_component(Modal, "Modal").$$render($$result, { title: task.taskname }, {}, {
		default: () => {
			return `<div class="${"taskDate svelte-1enhzbe"}"><p>Created on: ${escape(task.createdate)}</p></div>
  ${task.taskstate == "open"
			? `<div class="${"planSelection svelte-1enhzbe"}"><p>Plan:</p>
        ${selectedplan == ""
				? `<select><option value="${""}" selected="${"selected"}">None</option>${each(filteredplans, p => {
						return `<option${add_attribute("value", p, 0)}>${escape(p)}</option>`;
					})}</select>`
				: `<select ${selectedplan ? "default" : ""}><option value="${""}">None</option>${each(filteredplans, p => {
						return `${p == selectedplan
						? `<option${add_attribute("value", p, 0)} selected="${"selected"}">${escape(p)}</option>`
						: `<option${add_attribute("value", p, 0)}>${escape(p)}</option>`}`;
					})}</select>`}</div>`
			: ``}
  <div class="${"editSection svelte-1enhzbe"}">${validate_component(TextInput, "TextInput").$$render(
				$$result,
				{
					controlType: "textarea",
					value: task.taskdes,
					placeholder: "Edit description",
					rows: 4,
					readonly: task.taskstate == "closed"
				},
				{},
				{}
			)}

    <div class="${"btn svelte-1enhzbe"}">${validate_component(Button, "Button").$$render(
				$$result,
				{
					disabled: !(diff ),
					mode: "outline"
				},
				{},
				{
					default: () => {
						return `Edit`;
					}
				}
			)}</div></div>
  ${validate_component(TextInput, "TextInput").$$render(
				$$result,
				{
					id: "tasknotes",
					controlType: "textarea",
					readonly: true,
					rows: 5,
					resize: true,
					value: `Task Notes: ${task.tasknote}`
				},
				{},
				{}
			)}
  <div class="${"addnotecontainer svelte-1enhzbe"}">${task.taskstate != "closed"
			? `${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						id: "addnotes",
						controlType: "textarea",
						placeholder: "Enter new task notes",
						rows: "4",
						resize: true
					},
					{},
					{}
				)}
      <div class="${"btn svelte-1enhzbe"}">${validate_component(Button, "Button").$$render(
					$$result,
					{
						mode: "outline",
						disabled: addNoteDisable
					},
					{},
					{
						default: () => {
							return `Add Notes`;
						}
					}
				)}</div>`
			: ``}</div>
  <div class="${"buttonDiv svelte-1enhzbe"}">${validate_component(Button, "Button").$$render($$result, { mode: "danger" }, {}, {
				default: () => {
					return `Close`;
				}
			})}
    ${show
			? `${task.taskstate != "closed"
				? `<div class="${"btn-right"}">${task.taskstate == "doing" || task.taskstate == "done"
					? `${validate_component(Button, "Button").$$render($$result, { mode: "danger" }, {}, {
							default: () => {
								return `Demote`;
							}
						})}`
					: ``}
        ${validate_component(Button, "Button").$$render($$result, {}, {}, {
						default: () => {
							return `Promote`;
						}
					})}</div>`
				: ``}`
			: ``}</div>`;
		}
	})}`;
});

const appplancolors = writable({
  appColors: {},
  planColors: {}
});

function GenerateColorCode() {
  var makingColorCode = "0123456789ABCDEF";
  var finalCode = "#";
  for (var counter = 0; counter < 6; counter++) {
    finalCode = finalCode + makingColorCode[Math.floor(Math.random() * 16)];
  }
  return finalCode
}

function CheckRepeat(curr) {
  let currlist = get_store_value(appplancolors);
  let plans = Object.values(currlist.planColors);
  let apps = Object.values(currlist.appColors);
  let colors = plans + "," + apps;
  let colorsArr = colors.split(",");
  if (colorsArr.find(e => e == curr)) {
    return true
  } else {
    return false
  }
}

const appcolorMethods = {
  subscribe: appplancolors.subscribe,
  generateColors: GenerateColorCode(),
  addAppColors: appname => {
    appplancolors.update(items => {
      let appColors = items.appColors;
      var color = GenerateColorCode();
      while (CheckRepeat(color)) {
        var color = GenerateColorCode();
      }
      appColors[appname] = color;
      return { appColors, ...items }
    });
  },
  addPlanColors: planname => {
    appplancolors.update(items => {
      let planColors = items.planColors;
      var color = GenerateColorCode();
      while (CheckRepeat(color)) {
        var color = GenerateColorCode();
      }
      planColors[planname] = color;
      return { planColors, ...items }
    });
  }
};

const applications = writable([]);

const applicationMethods = {
  subscribe: applications.subscribe,
  addApplication: applicationData => {
    const newApplications = {
      ...applicationData
    };
    applications.update(items => {
      return [newApplications, ...items]
    });
  }
};

/* src\UI\Task.svelte generated by Svelte v3.50.1 */

const css$7 = {
	code: ".container.svelte-1bn43x9{position:relative}.task-container.svelte-1bn43x9{padding:4px 2px;border-radius:4px;border:2.5px solid var(--main-color);box-shadow:0px 2px 0px rgba(0, 0, 0, 0.45);margin-bottom:10px}.under.svelte-1bn43x9{background-color:#fff;transition:250ms;z-index:1;cursor:pointer;display:flex;min-height:100px;max-height:100px}.color.svelte-1bn43x9{width:6px;border-radius:25px}.right.svelte-1bn43x9{padding:3px 5px}.over.svelte-1bn43x9{position:absolute;bottom:15px;right:10px;z-index:3}.planColor.svelte-1bn43x9{position:absolute;top:5px;right:5px;width:20px;height:20px;border-radius:25px;border:1px solid #bebebe;box-shadow:1px 1px 0px rgba(0, 0, 0, 0.45)}.btn-sec-left.svelte-1bn43x9{position:absolute;left:15px;bottom:15px}.taskname.svelte-1bn43x9{font-family:sans-serif;font-weight:600}.taskdesc.svelte-1bn43x9{font-family:sans-serif;font-weight:500;font-size:12px;margin-left:2px}",
	map: "{\"version\":3,\"file\":\"Task.svelte\",\"sources\":[\"Task.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import { onMount } from \\\"svelte\\\";\\r\\n  import Button from \\\"./Button.svelte\\\";\\r\\n  import TaskForm from \\\"./TaskForm.svelte\\\";\\r\\n  import { createEventDispatcher } from \\\"svelte\\\";\\r\\n  import appcolorMethods from \\\"../store/color-store\\\";\\r\\n  import applicationMethods from \\\"../store/application-store\\\";\\r\\n\\r\\n  // subscribing to writable data\\r\\n  const colors = $appcolorMethods;\\r\\n\\r\\n  const dispatch = createEventDispatcher();\\r\\n  export let task;\\r\\n  export let stateColor;\\r\\n  export let state;\\r\\n  export let filteredplans;\\r\\n  let group = \\\"\\\";\\r\\n\\r\\n  $: group =\\r\\n    state === undefined\\r\\n      ? \\\"\\\"\\r\\n      : $applicationMethods.filter((e) => e.appname === task.taskacronym)[0][\\r\\n          state\\r\\n        ];\\r\\n\\r\\n  let modal = false;\\r\\n  let desc = \\\"\\\";\\r\\n  let show = false;\\r\\n\\r\\n  onMount(async () => {\\r\\n    // await fetchplansbyapp()\\r\\n    checkdes();\\r\\n    checkGroup();\\r\\n  });\\r\\n\\r\\n  $: {task, checkGroup()}\\r\\n\\r\\n  const checkdes = () => {\\r\\n    if (task.taskdes.length > 18) {\\r\\n      desc = task.taskdes.substring(0, 15) + \\\"...\\\";\\r\\n    } else {\\r\\n      desc = task.taskdes;\\r\\n    }\\r\\n  };\\r\\n\\r\\n  const showModal = () => {\\r\\n    modal = true;\\r\\n  };\\r\\n  const closeModal = () => {\\r\\n    checkdes();\\r\\n    modal = false;\\r\\n  };\\r\\n\\r\\n  const checkGroup = () => {\\r\\n    modal = false;\\r\\n    const url = \\\"http://localhost:8080/authorize\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        token: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        group: group,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        if (data.Message === \\\"true\\\") {\\r\\n          show = true;\\r\\n        } else {\\r\\n          show = false;\\r\\n        }\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  };\\r\\n\\r\\n  const promoteTask = () => {\\r\\n    modal = false;\\r\\n    const url = \\\"http://localhost:8080/changestate\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        taskid: task.taskid,\\r\\n        direction: 1,\\r\\n        taskstate: task.taskstate,\\r\\n        group: group,\\r\\n        tasknote: task.tasknote,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        dispatch(\\\"update\\\");\\r\\n        if (data.Code == 408) {\\r\\n          alert(\\\"You have no permission\\\");\\r\\n        }\\r\\n      })\\r\\n      .then(() => {\\r\\n        if (task.taskstate == \\\"doing\\\") {\\r\\n          const url = \\\"http://localhost:8080/email\\\";\\r\\n          fetch(url, {\\r\\n            method: \\\"POST\\\",\\r\\n            body: JSON.stringify({\\r\\n              editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n              taskid: task.taskid,\\r\\n              direction: 1,\\r\\n              taskstate: task.taskstate,\\r\\n              group: group,\\r\\n              tasknote: task.tasknote,\\r\\n            }),\\r\\n          });\\r\\n        }\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        alert(\\\"You have no permission\\\");\\r\\n      });\\r\\n  };\\r\\n\\r\\n  const demoteTask = () => {\\r\\n    modal = false;\\r\\n    const url = \\\"http://localhost:8080/changestate\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        taskid: task.taskid,\\r\\n        direction: 0,\\r\\n        taskstate: task.taskstate,\\r\\n        group: group,\\r\\n        tasknote: task.tasknote,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        dispatch(\\\"update\\\");\\r\\n        if (data.Code == 408) {\\r\\n          alert(\\\"You have no permission\\\");\\r\\n        }\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        alert(\\\"You have no permission\\\");\\r\\n      });\\r\\n  };\\r\\n  const update = () => {\\r\\n    dispatch(\\\"update\\\");\\r\\n    checkdes();\\r\\n  };\\r\\n\\r\\n  // colors dictionary, current task selected, type either plan or app (0 or 1)\\r\\n  function getColor(colors, task, type) {\\r\\n    if (type == 0) {\\r\\n      let planExist = Boolean(\\r\\n        Object.keys(colors.planColors).find((key) =>\\r\\n          key.includes(task.taskplan)\\r\\n        )\\r\\n      );\\r\\n      if (planExist && task.taskplan !== \\\"\\\") {\\r\\n        return colors.planColors[\\r\\n          Object.keys(colors.planColors).find((key) =>\\r\\n            key.includes(task.taskplan)\\r\\n          )\\r\\n        ];\\r\\n      } else {\\r\\n        return \\\"white\\\";\\r\\n      }\\r\\n    } else if (type == 1) {\\r\\n      let appExist = Boolean(\\r\\n        Object.keys(colors.appColors).find((key) =>\\r\\n          key.includes(task.taskacronym)\\r\\n        )\\r\\n      );\\r\\n      if (appExist && task.taskacronym !== \\\"\\\") {\\r\\n        return colors.appColors[\\r\\n          Object.keys(colors.appColors).find((key) =>\\r\\n            key.includes(task.taskacronym)\\r\\n          )\\r\\n        ];\\r\\n      } else {\\r\\n        return \\\"white\\\";\\r\\n      }\\r\\n    }\\r\\n  }\\r\\n</script>\\r\\n\\r\\n<main>\\r\\n  {#if modal}\\r\\n    <TaskForm\\r\\n      on:close={closeModal}\\r\\n      on:update={update}\\r\\n      on:promote={promoteTask}\\r\\n      on:demote={demoteTask}\\r\\n      {task}\\r\\n      oldTaskNote={task.taskdes}\\r\\n      {filteredplans}\\r\\n      {group}\\r\\n      {show}\\r\\n    />\\r\\n  {/if}\\r\\n  <div class=\\\"container\\\">\\r\\n    <div\\r\\n      class=\\\"task-container\\\"\\r\\n      style=\\\"border-color: {stateColor}\\\"\\r\\n      on:click={showModal}\\r\\n    >\\r\\n      <!-- svelte-ignore a11y-mouse-events-have-key-events -->\\r\\n      <div class=\\\"under\\\">\\r\\n        <span\\r\\n          class=\\\"color\\\"\\r\\n          style=\\\"background-color: {getColor(colors, task, 1)};\\\"\\r\\n        />\\r\\n        <div class=\\\"right\\\">\\r\\n          <p class=\\\"taskname\\\">\\r\\n            {task.taskname}\\r\\n          </p>\\r\\n          <p class=\\\"taskdesc\\\">\\r\\n            Desc: {desc}\\r\\n          </p>\\r\\n        </div>\\r\\n      </div>\\r\\n      <span\\r\\n        class=\\\"planColor\\\"\\r\\n        style=\\\"background-color: {getColor(colors, task, 0)};\\\"\\r\\n      />\\r\\n    </div>\\r\\n    {#if show}\\r\\n      <div>\\r\\n        {#if task.taskstate == \\\"doing\\\" || task.taskstate == \\\"done\\\"}\\r\\n          <div class=\\\"btn-sec-left\\\">\\r\\n            <Button on:click={demoteTask}>🡠</Button>\\r\\n          </div>\\r\\n          <div class=\\\"over\\\">\\r\\n            <Button on:click={promoteTask}>🡢</Button>\\r\\n          </div>\\r\\n        {:else if task.taskstate != \\\"closed\\\"}\\r\\n          <div class=\\\"over\\\">\\r\\n            <Button on:click={promoteTask}>🡢</Button>\\r\\n          </div>\\r\\n        {/if}\\r\\n      </div>\\r\\n    {/if}\\r\\n  </div>\\r\\n</main>\\r\\n\\r\\n<style>\\r\\n  .container {\\r\\n    position: relative;\\r\\n    /* width: 95%; */\\r\\n  }\\r\\n  .task-container {\\r\\n    padding: 4px 2px;\\r\\n    border-radius: 4px;\\r\\n    border: 2.5px solid var(--main-color);\\r\\n    box-shadow: 0px 2px 0px rgba(0, 0, 0, 0.45);\\r\\n    margin-bottom: 10px;\\r\\n  }\\r\\n  .under {\\r\\n    background-color: #fff;\\r\\n    transition: 250ms;\\r\\n    z-index: 1;\\r\\n    cursor: pointer;\\r\\n    display: flex;\\r\\n    min-height: 100px;\\r\\n    max-height: 100px;\\r\\n  }\\r\\n  .color {\\r\\n    width: 6px;\\r\\n    border-radius: 25px;\\r\\n  }\\r\\n  .right {\\r\\n    padding: 3px 5px;\\r\\n  }\\r\\n  .over {\\r\\n    position: absolute;\\r\\n    bottom: 15px;\\r\\n    right: 10px;\\r\\n    z-index: 3;\\r\\n  }\\r\\n  .planColor {\\r\\n    position: absolute;\\r\\n    top: 5px;\\r\\n    right: 5px;\\r\\n    width: 20px;\\r\\n    height: 20px;\\r\\n    border-radius: 25px;\\r\\n    border: 1px solid #bebebe;\\r\\n    box-shadow: 1px 1px 0px rgba(0, 0, 0, 0.45);\\r\\n  }\\r\\n  .btn-sec-left {\\r\\n    position: absolute;\\r\\n    left: 15px;\\r\\n    bottom: 15px;\\r\\n  }\\r\\n  .taskname {\\r\\n    font-family: sans-serif;\\r\\n    font-weight: 600;\\r\\n  }\\r\\n  .taskdesc {\\r\\n    font-family: sans-serif;\\r\\n    font-weight: 500;\\r\\n    font-size: 12px;\\r\\n    margin-left: 2px;\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAoPE,UAAU,eAAC,CAAC,AACV,QAAQ,CAAE,QAAQ,AAEpB,CAAC,AACD,eAAe,eAAC,CAAC,AACf,OAAO,CAAE,GAAG,CAAC,GAAG,CAChB,aAAa,CAAE,GAAG,CAClB,MAAM,CAAE,KAAK,CAAC,KAAK,CAAC,IAAI,YAAY,CAAC,CACrC,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAC3C,aAAa,CAAE,IAAI,AACrB,CAAC,AACD,MAAM,eAAC,CAAC,AACN,gBAAgB,CAAE,IAAI,CACtB,UAAU,CAAE,KAAK,CACjB,OAAO,CAAE,CAAC,CACV,MAAM,CAAE,OAAO,CACf,OAAO,CAAE,IAAI,CACb,UAAU,CAAE,KAAK,CACjB,UAAU,CAAE,KAAK,AACnB,CAAC,AACD,MAAM,eAAC,CAAC,AACN,KAAK,CAAE,GAAG,CACV,aAAa,CAAE,IAAI,AACrB,CAAC,AACD,MAAM,eAAC,CAAC,AACN,OAAO,CAAE,GAAG,CAAC,GAAG,AAClB,CAAC,AACD,KAAK,eAAC,CAAC,AACL,QAAQ,CAAE,QAAQ,CAClB,MAAM,CAAE,IAAI,CACZ,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,CAAC,AACZ,CAAC,AACD,UAAU,eAAC,CAAC,AACV,QAAQ,CAAE,QAAQ,CAClB,GAAG,CAAE,GAAG,CACR,KAAK,CAAE,GAAG,CACV,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,aAAa,CAAE,IAAI,CACnB,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,CACzB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAC7C,CAAC,AACD,aAAa,eAAC,CAAC,AACb,QAAQ,CAAE,QAAQ,CAClB,IAAI,CAAE,IAAI,CACV,MAAM,CAAE,IAAI,AACd,CAAC,AACD,SAAS,eAAC,CAAC,AACT,WAAW,CAAE,UAAU,CACvB,WAAW,CAAE,GAAG,AAClB,CAAC,AACD,SAAS,eAAC,CAAC,AACT,WAAW,CAAE,UAAU,CACvB,WAAW,CAAE,GAAG,CAChB,SAAS,CAAE,IAAI,CACf,WAAW,CAAE,GAAG,AAClB,CAAC\"}"
};

function getColor(colors, task, type) {
	if (type == 0) {
		let planExist = Boolean(Object.keys(colors.planColors).find(key => key.includes(task.taskplan)));

		if (planExist && task.taskplan !== "") {
			return colors.planColors[Object.keys(colors.planColors).find(key => key.includes(task.taskplan))];
		} else {
			return "white";
		}
	} else if (type == 1) {
		let appExist = Boolean(Object.keys(colors.appColors).find(key => key.includes(task.taskacronym)));

		if (appExist && task.taskacronym !== "") {
			return colors.appColors[Object.keys(colors.appColors).find(key => key.includes(task.taskacronym))];
		} else {
			return "white";
		}
	}
}

const Task = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $applicationMethods, $$unsubscribe_applicationMethods;
	let $appcolorMethods, $$unsubscribe_appcolorMethods;
	$$unsubscribe_applicationMethods = subscribe(applicationMethods, value => $applicationMethods = value);
	$$unsubscribe_appcolorMethods = subscribe(appcolorMethods, value => $appcolorMethods = value);

	// subscribing to writable data
	const colors = $appcolorMethods;

	createEventDispatcher();
	let { task } = $$props;
	let { stateColor } = $$props;
	let { state } = $$props;
	let { filteredplans } = $$props;
	let group = "";
	let modal = false;
	let desc = "";
	let show = false;

	onMount(async () => {
		// await fetchplansbyapp()
		checkdes();

		checkGroup();
	});

	const checkdes = () => {
		if (task.taskdes.length > 18) {
			desc = task.taskdes.substring(0, 15) + "...";
		} else {
			desc = task.taskdes;
		}
	};

	const checkGroup = () => {
		modal = false;
		const url = "http://localhost:8080/authorize";

		fetch(url, {
			method: "POST",
			body: JSON.stringify({
				token: sessionStorage.getItem("JWT"),
				group
			})
		}).then(response => response.json()).then(data => {
			if (data.Message === "true") {
				show = true;
			} else {
				show = false;
			}
		}).catch(error => {
			console.log(error);
		});
	};

	if ($$props.task === void 0 && $$bindings.task && task !== void 0) $$bindings.task(task);
	if ($$props.stateColor === void 0 && $$bindings.stateColor && stateColor !== void 0) $$bindings.stateColor(stateColor);
	if ($$props.state === void 0 && $$bindings.state && state !== void 0) $$bindings.state(state);
	if ($$props.filteredplans === void 0 && $$bindings.filteredplans && filteredplans !== void 0) $$bindings.filteredplans(filteredplans);
	$$result.css.add(css$7);

	group = state === undefined
	? ""
	: $applicationMethods.filter(e => e.appname === task.taskacronym)[0][state];

	{
		{
			(checkGroup());
		}
	}

	$$unsubscribe_applicationMethods();
	$$unsubscribe_appcolorMethods();

	return `<main>${modal
	? `${validate_component(TaskForm, "TaskForm").$$render(
			$$result,
			{
				task,
				oldTaskNote: task.taskdes,
				filteredplans,
				group,
				show
			},
			{},
			{}
		)}`
	: ``}
  <div class="${"container svelte-1bn43x9"}"><div class="${"task-container svelte-1bn43x9"}" style="${"border-color: " + escape(stateColor, true)}">
      <div class="${"under svelte-1bn43x9"}"><span class="${"color svelte-1bn43x9"}" style="${"background-color: " + escape(getColor(colors, task, 1), true) + ";"}"></span>
        <div class="${"right svelte-1bn43x9"}"><p class="${"taskname svelte-1bn43x9"}">${escape(task.taskname)}</p>
          <p class="${"taskdesc svelte-1bn43x9"}">Desc: ${escape(desc)}</p></div></div>
      <span class="${"planColor svelte-1bn43x9"}" style="${"background-color: " + escape(getColor(colors, task, 0), true) + ";"}"></span></div>
    ${show
	? `<div>${task.taskstate == "doing" || task.taskstate == "done"
		? `<div class="${"btn-sec-left svelte-1bn43x9"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
				default: () => {
					return `🡠`;
				}
			})}</div>
          <div class="${"over svelte-1bn43x9"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
				default: () => {
					return `🡢`;
				}
			})}</div>`
		: `${task.taskstate != "closed"
			? `<div class="${"over svelte-1bn43x9"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
					default: () => {
						return `🡢`;
					}
				})}</div>`
			: ``}`}</div>`
	: ``}</div>
</main>`;
});

/* src\components\AppForm.svelte generated by Svelte v3.50.1 */

const css$6 = {
	code: ".app-form.svelte-t151hz{display:flex;justify-content:space-around}.form-section.svelte-t151hz{width:40%}.btn-container.svelte-t151hz{right:1rem;position:absolute;display:flex;justify-content:flex-end}",
	map: "{\"version\":3,\"file\":\"AppForm.svelte\",\"sources\":[\"AppForm.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import { onMount, createEventDispatcher } from \\\"svelte\\\";\\r\\n  import Button from \\\"../UI/Button.svelte\\\";\\r\\n  import Modal from \\\"../UI/Modal.svelte\\\";\\r\\n  import TextInput from \\\"../UI/TextInput.svelte\\\";\\r\\n  import appcolorMethods from \\\"../store/color-store\\\";\\r\\n\\r\\n  export let grouplist = [];\\r\\n  export let appselected = \\\"\\\";\\r\\n  export let appData = [];\\r\\n  export let editapp;\\r\\n  export let plans;\\r\\n  \\r\\n  let appacronym = \\\"\\\";\\r\\n  let description = \\\"\\\";\\r\\n  let rnumber = \\\"\\\";\\r\\n  let startdate = \\\"\\\";\\r\\n  let enddate = \\\"\\\";\\r\\n  let permitcreate = \\\"\\\";\\r\\n  let permitdoing = \\\"\\\";\\r\\n  let permitdone = \\\"\\\";\\r\\n  let permitopen = \\\"\\\";\\r\\n  let permittodo = \\\"\\\";\\r\\n\\r\\n  const dispatch = createEventDispatcher()\\r\\n\\r\\n  onMount(() => {\\r\\n    getAllGroups();\\r\\n    if (editapp) {\\r\\n      const app = appData.find((app) => app.appacronym === appselected);\\r\\n      appacronym = app.appacronym;\\r\\n      description = app.description;\\r\\n      rnumber = app.rnumber;\\r\\n      startdate = app.startdate;\\r\\n      enddate = app.enddate;\\r\\n      permitcreate = app.permitcreate;\\r\\n      permitdoing = app.permitdoing;\\r\\n      permitdone = app.permitdone;\\r\\n      permitopen = app.permitopen;\\r\\n      permittodo = app.permittodo;\\r\\n    }\\r\\n  });\\r\\n\\r\\n  async function getAllGroups() {\\r\\n    const url = \\\"http://localhost:8080/fetchgroups\\\";\\r\\n    fetch(url)\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        const dataArr = data.map((grp) => grp.groupname);\\r\\n        grouplist = dataArr;\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  }\\r\\n  const createApp = () => {\\r\\n    const url = \\\"http://localhost:8080/createapp\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          AppAcronym: appacronym,\\r\\n          Description: description,\\r\\n          Rnumber: rnumber,\\r\\n          StartDate: startdate,\\r\\n          EndDate: enddate,\\r\\n          PermitCreate: permitcreate,\\r\\n          PermitDoing: permitdoing,\\r\\n          PermitDone: permitdone,\\r\\n          PermitOpen: permitopen,\\r\\n          PermitToDo: permittodo,\\r\\n          Editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n          Group: \\\"configmanager\\\",\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          if (data.Code != 200) {\\r\\n            alert(data.Message);\\r\\n          } else {\\r\\n            appcolorMethods.addAppColors(appacronym)\\r\\n            dispatch(\\\"update\\\")\\r\\n            alert(\\\"Successfully created application\\\");\\r\\n            emptyFields();\\r\\n            // window.location.reload(false);\\r\\n          }\\r\\n        })\\r\\n        .catch((error) => {\\r\\n          console.log(error);\\r\\n        });\\r\\n  }\\r\\n\\r\\n  const editApp = () => {\\r\\n    const url = \\\"http://localhost:8080/editapp\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          AppAcronym: appacronym,\\r\\n          PermitCreate: permitcreate,\\r\\n          PermitDoing: permitdoing,\\r\\n          PermitDone: permitdone,\\r\\n          PermitOpen: permitopen,\\r\\n          PermitToDo: permittodo,\\r\\n          Editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n          Group: \\\"configmanager\\\",\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          if (data.Code != 200) {\\r\\n            alert(data.Message);\\r\\n          } else {\\r\\n            dispatch(\\\"update\\\")\\r\\n            alert(\\\"Application successfully updated\\\");\\r\\n          }\\r\\n        })\\r\\n        .catch((error) => {\\r\\n          console.log(error);\\r\\n        });\\r\\n  }\\r\\n\\r\\n  const submitHandler = () => {\\r\\n    if (appacronym == \\\"\\\") {\\r\\n      alert(\\\"App Acronym can't be empty\\\");\\r\\n    } else if (plans.includes(appacronym)) {\\r\\n      alert(\\\"App name not allowed, please select a different app name\\\")\\r\\n    } else if (appacronym == \\\"allapps\\\") {\\r\\n      alert(\\\"Please use another app name\\\")\\r\\n    }  else if (startdate == \\\"\\\") {\\r\\n      alert(\\\"Start date can't be empty\\\");\\r\\n    } else if (startdate > enddate) {\\r\\n      alert(\\\"End date can't be empty\\\");\\r\\n    } else if (startdate > enddate) {\\r\\n      alert(\\\"Start date cannot before before the End date\\\");\\r\\n    } else if (rnumber == \\\"\\\") {\\r\\n      alert(\\\"App running number is required\\\");\\r\\n    } else {\\r\\n    editapp ? editApp() : createApp()\\r\\n    }\\r\\n  };\\r\\n\\r\\n  const emptyFields = () => {\\r\\n    appacronym = \\\"\\\";\\r\\n    description = \\\"\\\";\\r\\n    rnumber = \\\"\\\";\\r\\n    startdate = \\\"\\\";\\r\\n    enddate = \\\"\\\";\\r\\n    permitcreate = \\\"\\\";\\r\\n    permitdoing = \\\"\\\";\\r\\n    permitdone = \\\"\\\";\\r\\n    permitopen = \\\"\\\";\\r\\n    permittodo = \\\"\\\";\\r\\n  };\\r\\n</script>\\r\\n\\r\\n<Modal\\r\\n  title={editapp ? `Edit ${appselected}` : \\\"Create Application\\\"}\\r\\n  on:close\\r\\n  on:submit\\r\\n>\\r\\n  <form class=\\\"app-form\\\" on:submit|preventDefault={submitHandler}>\\r\\n    <div class=\\\"form-section\\\">\\r\\n      <TextInput\\r\\n        id=\\\"name\\\"\\r\\n        label=\\\"Application Name*\\\"\\r\\n        placeholder=\\\"Enter name\\\"\\r\\n        value={appacronym}\\r\\n        on:input={(e) => (appacronym = e.target.value)}\\r\\n        disable={editapp}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        id=\\\"name\\\"\\r\\n        controlType=\\\"textarea\\\"\\r\\n        rows=\\\"3\\\"\\r\\n        name=\\\"description\\\"\\r\\n        label=\\\"Application Description\\\"\\r\\n        placeholder=\\\"Enter description\\\"\\r\\n        value={description}\\r\\n        on:input={(e) => (description = e.target.value)}\\r\\n        disable={editapp}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        id=\\\"startdate\\\"\\r\\n        name=\\\"startdate\\\"\\r\\n        type=\\\"date\\\"\\r\\n        label=\\\"Start Date*\\\"\\r\\n        value={startdate}\\r\\n        on:input={(e) => (startdate = e.target.value)}\\r\\n        disable={editapp}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        id=\\\"enddate\\\"\\r\\n        name=\\\"enddate\\\"\\r\\n        type=\\\"date\\\"\\r\\n        label=\\\"End Date*\\\"\\r\\n        value={enddate}\\r\\n        on:input={(e) => (enddate = e.target.value)}\\r\\n        disable={editapp}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        id=\\\"runningnumber\\\"\\r\\n        type=\\\"number\\\"\\r\\n        label=\\\"Running Number*\\\"\\r\\n        placeholder=\\\"Enter running number\\\"\\r\\n        value={rnumber}\\r\\n        on:input={(e) => (rnumber = e.target.value)}\\r\\n        disable={editapp}\\r\\n      />\\r\\n    </div>\\r\\n\\r\\n    <div class=\\\"form-section\\\">\\r\\n      <TextInput\\r\\n        label=\\\"Create:\\\"\\r\\n        {grouplist}\\r\\n        controlType=\\\"select\\\"\\r\\n        value={permitcreate}\\r\\n        on:input={(e) => (permitcreate = e.target.value)}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        label=\\\"Open:\\\"\\r\\n        {grouplist}\\r\\n        controlType=\\\"select\\\"\\r\\n        value={permitopen}\\r\\n        on:input={(e) => (permitopen = e.target.value)}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        label=\\\"To-Do:\\\"\\r\\n        {grouplist}\\r\\n        controlType=\\\"select\\\"\\r\\n        value={permittodo}\\r\\n        on:input={(e) => (permittodo = e.target.value)}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        label=\\\"Doing:\\\"\\r\\n        {grouplist}\\r\\n        controlType=\\\"select\\\"\\r\\n        value={permitdoing}\\r\\n        on:input={(e) => (permitdoing = e.target.value)}\\r\\n      />\\r\\n\\r\\n      <TextInput\\r\\n        label=\\\"Done:\\\"\\r\\n        {grouplist}\\r\\n        controlType=\\\"select\\\"\\r\\n        value={permitdone}\\r\\n        on:input={(e) => (permitdone = e.target.value)}\\r\\n      />\\r\\n      <div class=\\\"btn-container \\\">\\r\\n        <Button type=\\\"submit\\\" mode=\\\"outline\\\">Submit</Button>\\r\\n      </div>\\r\\n    </div>\\r\\n  </form>\\r\\n</Modal>\\r\\n\\r\\n<style>\\r\\n  .app-form {\\r\\n    display: flex;\\r\\n    justify-content: space-around;\\r\\n  }\\r\\n  .form-section {\\r\\n    width: 40%;\\r\\n  }\\r\\n  .btn-container {\\r\\n    right: 1rem;\\r\\n    position: absolute;\\r\\n    display: flex;\\r\\n    justify-content: flex-end;\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAqQE,SAAS,cAAC,CAAC,AACT,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,YAAY,AAC/B,CAAC,AACD,aAAa,cAAC,CAAC,AACb,KAAK,CAAE,GAAG,AACZ,CAAC,AACD,cAAc,cAAC,CAAC,AACd,KAAK,CAAE,IAAI,CACX,QAAQ,CAAE,QAAQ,CAClB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,QAAQ,AAC3B,CAAC\"}"
};

const AppForm = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { grouplist = [] } = $$props;
	let { appselected = "" } = $$props;
	let { appData = [] } = $$props;
	let { editapp } = $$props;
	let { plans } = $$props;
	let appacronym = "";
	let description = "";
	let rnumber = "";
	let startdate = "";
	let enddate = "";
	let permitcreate = "";
	let permitdoing = "";
	let permitdone = "";
	let permitopen = "";
	let permittodo = "";
	createEventDispatcher();

	onMount(() => {
		getAllGroups();

		if (editapp) {
			const app = appData.find(app => app.appacronym === appselected);
			appacronym = app.appacronym;
			description = app.description;
			rnumber = app.rnumber;
			startdate = app.startdate;
			enddate = app.enddate;
			permitcreate = app.permitcreate;
			permitdoing = app.permitdoing;
			permitdone = app.permitdone;
			permitopen = app.permitopen;
			permittodo = app.permittodo;
		}
	});

	async function getAllGroups() {
		const url = "http://localhost:8080/fetchgroups";

		fetch(url).then(response => response.json()).then(data => {
			const dataArr = data.map(grp => grp.groupname);
			grouplist = dataArr;
		}).catch(error => {
			console.log(error);
		});
	}

	if ($$props.grouplist === void 0 && $$bindings.grouplist && grouplist !== void 0) $$bindings.grouplist(grouplist);
	if ($$props.appselected === void 0 && $$bindings.appselected && appselected !== void 0) $$bindings.appselected(appselected);
	if ($$props.appData === void 0 && $$bindings.appData && appData !== void 0) $$bindings.appData(appData);
	if ($$props.editapp === void 0 && $$bindings.editapp && editapp !== void 0) $$bindings.editapp(editapp);
	if ($$props.plans === void 0 && $$bindings.plans && plans !== void 0) $$bindings.plans(plans);
	$$result.css.add(css$6);

	return `${validate_component(Modal, "Modal").$$render(
		$$result,
		{
			title: editapp ? `Edit ${appselected}` : "Create Application"
		},
		{},
		{
			default: () => {
				return `<form class="${"app-form svelte-t151hz"}"><div class="${"form-section svelte-t151hz"}">${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						id: "name",
						label: "Application Name*",
						placeholder: "Enter name",
						value: appacronym,
						disable: editapp
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						id: "name",
						controlType: "textarea",
						rows: "3",
						name: "description",
						label: "Application Description",
						placeholder: "Enter description",
						value: description,
						disable: editapp
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						id: "startdate",
						name: "startdate",
						type: "date",
						label: "Start Date*",
						value: startdate,
						disable: editapp
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						id: "enddate",
						name: "enddate",
						type: "date",
						label: "End Date*",
						value: enddate,
						disable: editapp
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						id: "runningnumber",
						type: "number",
						label: "Running Number*",
						placeholder: "Enter running number",
						value: rnumber,
						disable: editapp
					},
					{},
					{}
				)}</div>

    <div class="${"form-section svelte-t151hz"}">${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						label: "Create:",
						grouplist,
						controlType: "select",
						value: permitcreate
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						label: "Open:",
						grouplist,
						controlType: "select",
						value: permitopen
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						label: "To-Do:",
						grouplist,
						controlType: "select",
						value: permittodo
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						label: "Doing:",
						grouplist,
						controlType: "select",
						value: permitdoing
					},
					{},
					{}
				)}

      ${validate_component(TextInput, "TextInput").$$render(
					$$result,
					{
						label: "Done:",
						grouplist,
						controlType: "select",
						value: permitdone
					},
					{},
					{}
				)}
      <div class="${"btn-container  svelte-t151hz"}">${validate_component(Button, "Button").$$render($$result, { type: "submit", mode: "outline" }, {}, {
					default: () => {
						return `Submit`;
					}
				})}</div></div></form>`;
			}
		}
	)}`;
});

/* src\components\TaskForma.svelte generated by Svelte v3.50.1 */

const css$5 = {
	code: ".task-form.svelte-1h13ssy{font-family:sans-serif;display:flex;flex-direction:column;justify-content:center}.btn-container.svelte-1h13ssy{width:100%;display:flex;justify-content:space-between}",
	map: "{\"version\":3,\"file\":\"TaskForma.svelte\",\"sources\":[\"TaskForma.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import Modal from \\\"../UI/Modal.svelte\\\";\\r\\n  import Button from \\\"../UI/Button.svelte\\\";\\r\\n  import TextInput from \\\"../UI/TextInput.svelte\\\";\\r\\n  import { createEventDispatcher } from \\\"svelte\\\";\\r\\n  import applicationMethods from \\\"../store/application-store\\\";\\r\\n\\r\\n  const dispatch = createEventDispatcher();\\r\\n  export let appselected;\\r\\n  export let state;\\r\\n  \\r\\n  let group = state === undefined ? \\\"\\\":$applicationMethods.filter(e => e.appname === appselected)[0][state]; \\r\\n\\r\\n\\r\\n  let notes = \\\"\\\";\\r\\n  let taskname = \\\"\\\";\\r\\n  let taskdes = \\\"\\\";\\r\\n\\r\\n  const emptyFields = () => {\\r\\n    notes = \\\"\\\"\\r\\n    taskname = \\\"\\\";\\r\\n    taskdes = \\\"\\\";\\r\\n  };\\r\\n\\r\\n  const createTask = () => {\\r\\n    if (taskname == \\\"\\\") {\\r\\n      alert(\\\"Task name can't be empty\\\");\\r\\n      return;\\r\\n    }\\r\\n\\r\\n    // let valueone = `Add Note...`;\\r\\n    // let taskselected = \\\"\\\";\\r\\n    // let tasknames = [\\\"QW\\\",\\\"DS\\\",\\\"FD\\\"];\\r\\n\\r\\n    // const createTask = (e) => {\\r\\n    // e.preventDefault();\\r\\n    // console.log(rnumber);\\r\\n    const url = \\\"http://localhost:8080/createtask\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        taskname: taskname,\\r\\n        taskdes: taskdes,\\r\\n        addedtasknote: notes,\\r\\n        taskacronym: appselected,\\r\\n        editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        group: group,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        if (data.code != 200) {\\r\\n          alert(data.Message);\\r\\n        } else {\\r\\n        alert(\\\"Task successfully added.\\\");}\\r\\n        dispatch(\\\"update\\\")\\r\\n        emptyFields();\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  };\\r\\n</script>\\r\\n\\r\\n<Modal title=\\\"Create task\\\" on:close>\\r\\n  <form class=\\\"task-form\\\" on:submit|preventDefault={createTask} >\\r\\n    <TextInput\\r\\n      id=\\\"name\\\"\\r\\n      type=\\\"text\\\"\\r\\n      label=\\\"Task Name: \\\"\\r\\n      placeholder=\\\"Enter task name\\\"\\r\\n      value={taskname}\\r\\n      on:input={(e) => (taskname = e.target.value)}\\r\\n    />\\r\\n\\r\\n    <TextInput\\r\\n      controlType=\\\"textarea\\\"\\r\\n      id=\\\"description\\\"\\r\\n      label=\\\"Task Description\\\"\\r\\n      rows=\\\"3\\\"\\r\\n      resize={true}\\r\\n      placeholder=\\\"Enter task description\\\"\\r\\n      value={taskdes}\\r\\n      on:input={(e) => (taskdes = e.target.value)}\\r\\n    />\\r\\n\\r\\n    <TextInput\\r\\n      controlType=\\\"textarea\\\"\\r\\n      id=\\\"notes\\\"\\r\\n      label=\\\"Notes\\\"\\r\\n      placeholder=\\\"Enter task notes\\\"\\r\\n      resize={true}\\r\\n      rows=\\\"3\\\"\\r\\n      value={notes}\\r\\n      on:input={(e) => (notes = e.target.value)}\\r\\n    />\\r\\n\\r\\n    <div class=\\\"btn-container\\\">\\r\\n      <div></div>\\r\\n      <Button type=\\\"submit\\\" mode=\\\"outline\\\">Submit</Button>\\r\\n    </div>\\r\\n  </form>\\r\\n</Modal>\\r\\n\\r\\n<style>\\r\\n  .task-form {\\r\\n    font-family: sans-serif;\\r\\n    display: flex;\\r\\n    flex-direction: column;\\r\\n    justify-content: center;\\r\\n  }\\r\\n  .btn-container {\\r\\n    width: 100%;\\r\\n    display: flex;\\r\\n    justify-content: space-between;\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAyGE,UAAU,eAAC,CAAC,AACV,WAAW,CAAE,UAAU,CACvB,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,CACtB,eAAe,CAAE,MAAM,AACzB,CAAC,AACD,cAAc,eAAC,CAAC,AACd,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,aAAa,AAChC,CAAC\"}"
};

const TaskForma$1 = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $applicationMethods, $$unsubscribe_applicationMethods;
	$$unsubscribe_applicationMethods = subscribe(applicationMethods, value => $applicationMethods = value);
	createEventDispatcher();
	let { appselected } = $$props;
	let { state } = $$props;

	state === undefined
	? ""
	: $applicationMethods.filter(e => e.appname === appselected)[0][state];

	let notes = "";
	let taskname = "";
	let taskdes = "";

	if ($$props.appselected === void 0 && $$bindings.appselected && appselected !== void 0) $$bindings.appselected(appselected);
	if ($$props.state === void 0 && $$bindings.state && state !== void 0) $$bindings.state(state);
	$$result.css.add(css$5);
	$$unsubscribe_applicationMethods();

	return `${validate_component(Modal, "Modal").$$render($$result, { title: "Create task" }, {}, {
		default: () => {
			return `<form class="${"task-form svelte-1h13ssy"}">${validate_component(TextInput, "TextInput").$$render(
				$$result,
				{
					id: "name",
					type: "text",
					label: "Task Name: ",
					placeholder: "Enter task name",
					value: taskname
				},
				{},
				{}
			)}

    ${validate_component(TextInput, "TextInput").$$render(
				$$result,
				{
					controlType: "textarea",
					id: "description",
					label: "Task Description",
					rows: "3",
					resize: true,
					placeholder: "Enter task description",
					value: taskdes
				},
				{},
				{}
			)}

    ${validate_component(TextInput, "TextInput").$$render(
				$$result,
				{
					controlType: "textarea",
					id: "notes",
					label: "Notes",
					placeholder: "Enter task notes",
					resize: true,
					rows: "3",
					value: notes
				},
				{},
				{}
			)}

    <div class="${"btn-container svelte-1h13ssy"}"><div></div>
      ${validate_component(Button, "Button").$$render($$result, { type: "submit", mode: "outline" }, {}, {
				default: () => {
					return `Submit`;
				}
			})}</div></form>`;
		}
	})}`;
});

/* src\UI\ScrollingList.svelte generated by Svelte v3.50.1 */

const css$4 = {
	code: ".list.svelte-1274acw{font-weight:normal;overflow-y:auto;border:1px solid #444;margin-top:10px}.list-item.svelte-1274acw{cursor:pointer;color:black}#allapps.svelte-1274acw{background-color:rgba(208, 208, 68, 0.232);color:red}#allplans.svelte-1274acw{background-color:rgba(208, 208, 68, 0.232);color:red}.legend-container.svelte-1274acw{position:relative;width:100%;display:flex;align-items:center;margin:.2rem 0}.legend.svelte-1274acw{position:absolute;border-radius:1px;box-shadow:1px 1px 0px rgba(0,0,0,0.7);right:10px;width:15px;height:15px}",
	map: "{\"version\":3,\"file\":\"ScrollingList.svelte\",\"sources\":[\"ScrollingList.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import { createEventDispatcher} from \\\"svelte\\\";\\r\\n  import appcolorMethods from \\\"../store/color-store\\\";\\r\\n\\r\\n  export let arr;\\r\\n  export let type;\\r\\n  export let appselected;\\r\\n  export let planselected;\\r\\n\\r\\n  const dispatch = createEventDispatcher();\\r\\n\\r\\n  const activateHighlight = (id, type) => {\\r\\n    if (type === \\\"application\\\") {\\r\\n      for (var i =0; i < arr.length; i++){\\r\\n        document.getElementById(arr[i]).style.color = \\\"black\\\"\\r\\n        document.getElementById(arr[i]).style.backgroundColor = \\\"white\\\"\\r\\n      }\\r\\n      document.getElementById(id).style.color = \\\"red\\\";\\r\\n      document.getElementById(id).style.backgroundColor = \\\"rgba(208, 208, 68, 0.232)\\\";\\r\\n\\r\\n      \\r\\n      if (planselected !== \\\"allplans\\\" && appselected !== \\\"allapps\\\") {\\r\\n        document.getElementById(\\\"allplans\\\").style.color = \\\"red\\\";\\r\\n        document.getElementById(\\\"allplans\\\").style.backgroundColor = \\\"rgba(208, 208, 68, 0.232)\\\";\\r\\n\\r\\n        document.getElementById(planselected).style.color = \\\"black\\\";\\r\\n        document.getElementById(planselected).style.backgroundColor = \\\"white\\\";\\r\\n      }\\r\\n\\r\\n    } \\r\\n    if (type === \\\"plan\\\") {\\r\\n      // switch all plan selection to black except for the selected plan\\r\\n      for (var i =0; i < arr.length; i++){\\r\\n        document.getElementById(arr[i]).style.color = \\\"black\\\"\\r\\n        document.getElementById(arr[i]).style.backgroundColor = \\\"white\\\"\\r\\n      }\\r\\n      document.getElementById(id).style.color = \\\"red\\\";\\r\\n      document.getElementById(id).style.backgroundColor = \\\"rgba(208, 208, 68, 0.232)\\\";\\r\\n\\r\\n      if (appselected === \\\"allapps\\\"){\\r\\n        document.getElementById(\\\"allplans\\\").style.color = \\\"red\\\";\\r\\n        document.getElementById(\\\"allplans\\\").style.backgroundColor = \\\"rgba(208, 208, 68, 0.232)\\\";\\r\\n      }\\r\\n      if (planselected !== \\\"allplans\\\") {\\r\\n        document.getElementById(\\\"allplans\\\").style.color = \\\"black\\\";\\r\\n        document.getElementById(\\\"allplans\\\").style.backgroundColor = \\\"white\\\";\\r\\n      }\\r\\n      if (id === \\\"allplans\\\"){\\r\\n        document.getElementById(\\\"allplans\\\").style.color = \\\"red\\\";\\r\\n        document.getElementById(\\\"allplans\\\").style.backgroundColor = \\\"rgba(208, 208, 68, 0.232)\\\";\\r\\n      }\\r\\n      \\r\\n    }\\r\\n    dispatch(\\\"selected\\\",id);\\r\\n      \\r\\n  }\\r\\n\\r\\n</script>\\r\\n\\r\\n<div class=\\\"list\\\">\\r\\n  {#each arr as a (a)}\\r\\n        <ul >\\r\\n          <div class=\\\"list-item\\\" >\\r\\n            <li  class=\\\"legend-container\\\" on:click={activateHighlight(a,type)} id={a}>\\r\\n              {a}\\r\\n              <span \\r\\n                class=\\\"legend\\\" \\r\\n                style=\\\"background-color: {type == \\\"application\\\" ? $appcolorMethods.appColors[a] : type == \\\"plan\\\" ? $appcolorMethods.planColors[a] : \\\"\\\"}; {type == \\\"plan\\\" ? \\\"border-radius: 25px;\\\" : \\\"\\\"};\\\">\\r\\n              </span>\\r\\n            </li>\\r\\n          </div>\\r\\n        </ul>\\r\\n     \\r\\n  {/each}\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n.list {\\r\\n    font-weight: normal;\\r\\n    overflow-y: auto;\\r\\n    border: 1px solid #444;\\r\\n    margin-top: 10px;\\r\\n    \\r\\n  }\\r\\n.list-item {\\r\\n  /* border: 1px 1px solid rgb(5, 5, 5); */\\r\\n  cursor: pointer;\\r\\n  color: black;\\r\\n}\\r\\n#allapps {\\r\\n  /* background-color: rgb(255, 255, 255); */\\r\\n  background-color: rgba(208, 208, 68, 0.232);\\r\\n  color: red;\\r\\n}\\r\\n#allplans {\\r\\n  background-color: rgba(208, 208, 68, 0.232);\\r\\n  color: red;\\r\\n}\\r\\n.legend-container {\\r\\n  position: relative;\\r\\n  width: 100%;\\r\\n  display: flex;\\r\\n  align-items: center;\\r\\n  margin: .2rem 0;\\r\\n}\\r\\n.legend{\\r\\n  position: absolute;\\r\\n  border-radius: 1px;\\r\\n  box-shadow: 1px 1px 0px rgba(0,0,0,0.7);\\r\\n  right: 10px;\\r\\n  width: 15px;\\r\\n  height: 15px;\\r\\n}\\r\\n\\r\\n\\r\\n</style>\"],\"names\":[],\"mappings\":\"AA6EA,KAAK,eAAC,CAAC,AACH,WAAW,CAAE,MAAM,CACnB,UAAU,CAAE,IAAI,CAChB,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,CACtB,UAAU,CAAE,IAAI,AAElB,CAAC,AACH,UAAU,eAAC,CAAC,AAEV,MAAM,CAAE,OAAO,CACf,KAAK,CAAE,KAAK,AACd,CAAC,AACD,QAAQ,eAAC,CAAC,AAER,gBAAgB,CAAE,KAAK,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,EAAE,CAAC,CAAC,KAAK,CAAC,CAC3C,KAAK,CAAE,GAAG,AACZ,CAAC,AACD,SAAS,eAAC,CAAC,AACT,gBAAgB,CAAE,KAAK,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,EAAE,CAAC,CAAC,KAAK,CAAC,CAC3C,KAAK,CAAE,GAAG,AACZ,CAAC,AACD,iBAAiB,eAAC,CAAC,AACjB,QAAQ,CAAE,QAAQ,CAClB,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,IAAI,CACb,WAAW,CAAE,MAAM,CACnB,MAAM,CAAE,KAAK,CAAC,CAAC,AACjB,CAAC,AACD,sBAAO,CAAC,AACN,QAAQ,CAAE,QAAQ,CAClB,aAAa,CAAE,GAAG,CAClB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,GAAG,CAAC,CACvC,KAAK,CAAE,IAAI,CACX,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,AACd,CAAC\"}"
};

const ScrollingList = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $appcolorMethods, $$unsubscribe_appcolorMethods;
	$$unsubscribe_appcolorMethods = subscribe(appcolorMethods, value => $appcolorMethods = value);
	let { arr } = $$props;
	let { type } = $$props;
	let { appselected } = $$props;
	let { planselected } = $$props;
	createEventDispatcher();

	if ($$props.arr === void 0 && $$bindings.arr && arr !== void 0) $$bindings.arr(arr);
	if ($$props.type === void 0 && $$bindings.type && type !== void 0) $$bindings.type(type);
	if ($$props.appselected === void 0 && $$bindings.appselected && appselected !== void 0) $$bindings.appselected(appselected);
	if ($$props.planselected === void 0 && $$bindings.planselected && planselected !== void 0) $$bindings.planselected(planselected);
	$$result.css.add(css$4);
	$$unsubscribe_appcolorMethods();

	return `<div class="${"list svelte-1274acw"}">${each(arr, a => {
		return `<ul><div class="${"list-item svelte-1274acw"}"><li class="${"legend-container svelte-1274acw"}"${add_attribute("id", a, 0)}>${escape(a)}
              <span class="${"legend svelte-1274acw"}" style="${"background-color: " + escape(
			type == "application"
			? $appcolorMethods.appColors[a]
			: type == "plan" ? $appcolorMethods.planColors[a] : "",
			true
		) + "; " + escape(type == "plan" ? "border-radius: 25px;" : "", true) + ";"}"></span>
            </li></div>
        </ul>`;
	})}
</div>`;
});

/* src\components\DashboardContent.svelte generated by Svelte v3.50.1 */

const css$3 = {
	code: ".container.svelte-w8pctw.svelte-w8pctw{display:flex;width:100vw;min-height:91vh;overflow-y:hidden;overflow-x:hidden;font-family:sans-serif;font-size:0.8rem}.left-sidebar.svelte-w8pctw.svelte-w8pctw{display:flex;flex-direction:column;background-color:#5e91cb;width:15vw;height:91vh}.left-section.svelte-w8pctw.svelte-w8pctw{padding:0.5rem;margin:0.5rem;border-radius:8px;border:3px solid var(--main-color);height:45%;background-color:#fff;margin-bottom:15px;box-shadow:0px 3px 8px rgba(0, 0, 0, 0.45);overflow:auto}.left-section.svelte-w8pctw p.svelte-w8pctw{text-align:center;margin-bottom:0.4rem;font-weight:bold}.right.svelte-w8pctw.svelte-w8pctw{display:flex;width:85vw;height:91vh}.state.svelte-w8pctw.svelte-w8pctw{border-right:2px solid #cecece;height:100%;width:20%;padding:10px}.header.svelte-w8pctw.svelte-w8pctw{width:100%;height:5%;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #cecece;border-radius:15px;font-family:sans-serif;box-shadow:0px 4px 10px rgba(0, 0, 0, 0.45);margin-bottom:15px}.header.svelte-w8pctw p.svelte-w8pctw{font-size:22px;font-weight:500}.button-center.svelte-w8pctw.svelte-w8pctw{text-align:center}.button-task.svelte-w8pctw.svelte-w8pctw{margin:1rem;text-align:center}.task-container.svelte-w8pctw.svelte-w8pctw{overflow-y:scroll;height:78vh;padding-right:10px}.svelte-w8pctw.svelte-w8pctw::-webkit-scrollbar{width:6px;padding:2px}.svelte-w8pctw.svelte-w8pctw::-webkit-scrollbar-track{border-radius:10px}.svelte-w8pctw.svelte-w8pctw::-webkit-scrollbar-thumb{background:grey;border-radius:10px;height:10px}",
	map: "{\"version\":3,\"file\":\"DashboardContent.svelte\",\"sources\":[\"DashboardContent.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import Task from \\\"../UI/Task.svelte\\\";\\r\\n  import Button from \\\"../UI/Button.svelte\\\";\\r\\n  import CreatePlan from \\\"./CreatePlan.svelte\\\";\\r\\n  import AppForm from \\\"./AppForm.svelte\\\";\\r\\n  import TaskForma from \\\"./TaskForma.svelte\\\";\\r\\n  import { onMount, onDestroy } from \\\"svelte\\\";\\r\\n  import applicationMethods from \\\"../store/application-store\\\";\\r\\n  import appcolorMethods from \\\"../store/color-store\\\";\\r\\n  import ScrollingList from \\\"../UI/ScrollingList.svelte\\\";\\r\\n\\r\\n  let showcreatetaskB = false;\\r\\n  let showcreateplanB = false;\\r\\n  let showcreateappB = false;\\r\\n\\r\\n  let initialtask = [];\\r\\n  let filteredtask = [];\\r\\n  let appData = [];\\r\\n  let apps = [];\\r\\n  let plans = [];\\r\\n  let filteredplans = [];\\r\\n  let appselected = \\\"allapps\\\";\\r\\n  let planselected = \\\"allplans\\\";\\r\\n  let createPlan = false;\\r\\n  let appForm = false;\\r\\n  let taskForm = false;\\r\\n  let editapp = false;\\r\\n\\r\\n  let appPermission;\\r\\n\\r\\n  let openColor = \\\"#e7d3ec\\\";\\r\\n  let todoColor = \\\"#e1e157\\\";\\r\\n  let doingColor = \\\"#e2bb74\\\";\\r\\n  let doneColor = \\\"#c2e5ae\\\";\\r\\n  let closeColor = \\\"#f1a99b\\\";\\r\\n\\r\\n  onMount(async () => {\\r\\n    // await fetchtask()\\r\\n    // await Promise.all([fetchtask, fetchApps])\\r\\n    await fetchApps();\\r\\n    await fetchplans();\\r\\n    addAppPermissionData();\\r\\n    addappplanColor(apps, plans);\\r\\n    fetchtask();\\r\\n    createAppPermission();\\r\\n  });\\r\\n\\r\\n  const fetchtask = () => {\\r\\n    return new Promise((resolve, reject) => {\\r\\n      const url = \\\"http://localhost:8080/getalltask\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          initialtask = data;\\r\\n          filteredtask = initialtask;\\r\\n          resolve();\\r\\n        })\\r\\n        .catch((err) => {\\r\\n          console.log(err);\\r\\n        });\\r\\n    });\\r\\n  };\\r\\n\\r\\n  const fetchtaskbyapp = () => {\\r\\n    return new Promise((resolve, reject) => {\\r\\n      const url = \\\"http://localhost:8080/getalltaskbyacronym\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n          taskacronym: appselected,\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          filteredtask = data;\\r\\n        })\\r\\n        .catch((err) => {\\r\\n          console.log(err);\\r\\n        });\\r\\n    });\\r\\n  };\\r\\n\\r\\n  const fetchplansbyapp = () => {\\r\\n    return new Promise((resolve, reject) => {\\r\\n      const url = \\\"http://localhost:8080/getplanbyapp\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n          acronym: appselected,\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          filteredplans = data.map((e) => e.planname);\\r\\n          resolve();\\r\\n        })\\r\\n        .catch((err) => {\\r\\n          console.log(err);\\r\\n        });\\r\\n    });\\r\\n  };\\r\\n\\r\\n  const fetchtaskbyappplan = () => {\\r\\n    return new Promise((resolve, reject) => {\\r\\n      const url = \\\"http://localhost:8080/getalltaskbyacronymnplan\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n          taskacronym: appselected,\\r\\n          taskplan: planselected,\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          filteredtask = data;\\r\\n          resolve();\\r\\n        })\\r\\n        .catch((err) => {\\r\\n          console.log(err);\\r\\n        });\\r\\n    });\\r\\n  };\\r\\n\\r\\n  function addappplanColor(apps, plans) {\\r\\n    for (let i = 0; i < apps.length; i++) {\\r\\n      appcolorMethods.addAppColors(apps[i]);\\r\\n    }\\r\\n\\r\\n    for (let i = 0; i < plans.length; i++) {\\r\\n      appcolorMethods.addPlanColors(plans[i]);\\r\\n    }\\r\\n  }\\r\\n\\r\\n  const unsubscribeAppPermission = applicationMethods.subscribe(\\r\\n    (application) => (appPermission = application)\\r\\n  );\\r\\n\\r\\n  function addAppPermissionData() {\\r\\n    for (let i = 0; i < appData.length; i++) {\\r\\n      let app = {};\\r\\n\\r\\n      app[\\\"appname\\\"] = appData[i][\\\"appacronym\\\"];\\r\\n      app[\\\"permitCreate\\\"] = appData[i][\\\"permitcreate\\\"];\\r\\n      app[\\\"permitOpen\\\"] = appData[i][\\\"permitopen\\\"];\\r\\n      app[\\\"permitTodo\\\"] = appData[i][\\\"permittodo\\\"];\\r\\n      app[\\\"permitDoing\\\"] = appData[i][\\\"permitdoing\\\"];\\r\\n      app[\\\"permitDone\\\"] = appData[i][\\\"permitdone\\\"];\\r\\n\\r\\n      applicationMethods.addApplication(app);\\r\\n    }\\r\\n  }\\r\\n\\r\\n  onDestroy(() => {\\r\\n    unsubscribeAppPermission();\\r\\n  });\\r\\n\\r\\n  const fetchApps = () => {\\r\\n    return new Promise((resolve, reject) => {\\r\\n      const url = \\\"http://localhost:8080/fetchapps\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          appData = data;\\r\\n          apps = data.map((app) => app.appacronym);\\r\\n          resolve();\\r\\n        })\\r\\n        .catch((err) => {\\r\\n          console.log(err);\\r\\n        });\\r\\n    });\\r\\n  };\\r\\n\\r\\n  const fetchplans = () => {\\r\\n    return new Promise((resolve, reject) => {\\r\\n      const url = \\\"http://localhost:8080/getallplan\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          plans = data.map((plan) => plan.planname);\\r\\n          resolve();\\r\\n        })\\r\\n        .catch((err) => {\\r\\n          console.log(err);\\r\\n        });\\r\\n    });\\r\\n  };\\r\\n\\r\\n  const showCreatePlan = () => {\\r\\n    createPlan = true;\\r\\n  };\\r\\n  const closeCreatePlan = () => {\\r\\n    createPlan = false;\\r\\n  };\\r\\n\\r\\n  const getAllUpdatedTask = async () => {\\r\\n    if (appselected === \\\"allapps\\\") {\\r\\n      fetchtask();\\r\\n    } else if (appselected !== \\\"allapps\\\" && planselected === \\\"allplans\\\") {\\r\\n      fetchtaskbyapp();\\r\\n    } else if (planselected !== \\\"allplans\\\" && appselected !== \\\"allapps\\\") {\\r\\n      fetchtaskbyappplan();\\r\\n    }\\r\\n  };\\r\\n  const toggleAppForm = (e) => {\\r\\n    if (e.currentTarget) {\\r\\n      if (e.currentTarget.id === \\\"editapp\\\") {\\r\\n        editapp = true;\\r\\n      } else {\\r\\n        editapp = false;\\r\\n      }\\r\\n    }\\r\\n\\r\\n    appForm = !appForm;\\r\\n  };\\r\\n  const toggleTaskForm = () => {\\r\\n    taskForm = !taskForm;\\r\\n  };\\r\\n\\r\\n  const filterTaskByApp = async (event) => {\\r\\n    appselected = event.detail;\\r\\n\\r\\n    if (appselected === \\\"allapps\\\") {\\r\\n      await fetchtask();\\r\\n      // filteredtask = initialtask\\r\\n    } else if (appselected !== \\\"allapps\\\") {\\r\\n      await fetchtask();\\r\\n      filteredtask = initialtask.filter((e) => e.taskacronym === appselected);\\r\\n      await fetchplansbyapp();\\r\\n      planselected = \\\"allplans\\\";\\r\\n      createTaskPermission();\\r\\n      createPlanPermission();\\r\\n    }\\r\\n  };\\r\\n\\r\\n  const filterTaskByAppPlan = async (event) => {\\r\\n    planselected = event.detail;\\r\\n    if (planselected === \\\"allplans\\\") {\\r\\n      await fetchtaskbyapp();\\r\\n    } else {\\r\\n      await fetchtaskbyappplan();\\r\\n      filteredtask = filteredtask.filter((e) => e.taskplan === planselected);\\r\\n    }\\r\\n  };\\r\\n\\r\\n  const checkGroup = (token, group, type) => {\\r\\n    const url = \\\"http://localhost:8080/authorize\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        token: token,\\r\\n        group: group,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        if (data.Message === \\\"true\\\") {\\r\\n          if (type === \\\"task\\\") {\\r\\n            showcreatetaskB = true;\\r\\n          } else if (type === \\\"plan\\\") {\\r\\n            showcreateplanB = true;\\r\\n          } else if (type === \\\"app\\\") {\\r\\n            showcreateappB = true;\\r\\n          }\\r\\n        } else {\\r\\n          if (type === \\\"task\\\") {\\r\\n            showcreatetaskB = false;\\r\\n          } else if (type === \\\"plan\\\") {\\r\\n            showcreateplanB = false;\\r\\n          } else if (type === \\\"app\\\") {\\r\\n            showcreateplanB = false;\\r\\n          }\\r\\n        }\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  };\\r\\n\\r\\n  const createTaskPermission = () => {\\r\\n    if (\\r\\n      $applicationMethods.filter((e) => e.appname === appselected).length === 0\\r\\n    ) {\\r\\n      showcreatetaskB = false;\\r\\n    } else {\\r\\n      checkGroup(\\r\\n        sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        $applicationMethods.filter((e) => e.appname === appselected)[0][\\r\\n          \\\"permitCreate\\\"\\r\\n        ],\\r\\n        \\\"task\\\"\\r\\n      );\\r\\n    }\\r\\n  };\\r\\n\\r\\n  const createPlanPermission = () => {\\r\\n    if (\\r\\n      $applicationMethods.filter((e) => e.appname === appselected).length === 0\\r\\n    ) {\\r\\n      showcreateplanB = false;\\r\\n    } else {\\r\\n      checkGroup(\\r\\n        sessionStorage.getItem(\\\"JWT\\\"),\\r\\n        $applicationMethods.filter((e) => e.appname === appselected)[0][\\r\\n          \\\"permitOpen\\\"\\r\\n        ],\\r\\n        \\\"plan\\\"\\r\\n      );\\r\\n    }\\r\\n  };\\r\\n\\r\\n  const createAppPermission = () => {\\r\\n    checkGroup(sessionStorage.getItem(\\\"JWT\\\"), \\\"configmanager\\\", \\\"app\\\");\\r\\n  };\\r\\n\\r\\n  const updateApp = async() => {\\r\\n    await fetchApps();\\r\\n    addAppPermissionData();\\r\\n    createTaskPermission();\\r\\n    createPlanPermission();\\r\\n  }\\r\\n</script>\\r\\n\\r\\n<main class=\\\"container\\\">\\r\\n  <div class=\\\"left-sidebar\\\">\\r\\n    <div class=\\\"left-section\\\">\\r\\n      <p>Applications</p>\\r\\n\\r\\n      <div class=\\\"button-center\\\">\\r\\n        {#if showcreateappB}\\r\\n          <Button id=\\\"newapp\\\" size=\\\"sm\\\" mode=\\\"outline\\\" on:click={toggleAppForm}\\r\\n            >New App</Button\\r\\n          >\\r\\n        {/if}\\r\\n        {#if showcreateappB && appselected !== \\\"allapps\\\"}\\r\\n          <Button id=\\\"editapp\\\" size=\\\"sm\\\" mode=\\\"outline\\\" on:click={toggleAppForm}\\r\\n            >Edit App</Button\\r\\n          >\\r\\n        {/if}\\r\\n      </div>\\r\\n      <ScrollingList\\r\\n        arr={[\\\"allapps\\\", ...apps]}\\r\\n        on:selected={filterTaskByApp}\\r\\n        type=\\\"application\\\"\\r\\n        {appselected}\\r\\n        {planselected}\\r\\n      />\\r\\n    </div>\\r\\n    {#if appselected != \\\"allapps\\\"}\\r\\n      <div class=\\\"left-section\\\">\\r\\n        <p>Plans</p>\\r\\n\\r\\n        {#if showcreateplanB}\\r\\n          <div class=\\\"button-center\\\">\\r\\n            <Button size=\\\"sm\\\" mode=\\\"outline\\\" on:click={showCreatePlan}>\\r\\n              New Plan\\r\\n            </Button>\\r\\n          </div>\\r\\n        {/if}\\r\\n\\r\\n        <ScrollingList\\r\\n          arr={[\\\"allplans\\\", ...filteredplans]}\\r\\n          on:selected={filterTaskByAppPlan}\\r\\n          type=\\\"plan\\\"\\r\\n        />\\r\\n      </div>\\r\\n    {/if}\\r\\n  </div>\\r\\n\\r\\n  {#if appForm}\\r\\n    <AppForm plans={[\\\"allplans\\\", ...plans]} on:update={updateApp} on:close={toggleAppForm} {appselected} {appData} {editapp} />\\r\\n  {/if}\\r\\n\\r\\n  {#if taskForm}\\r\\n    <TaskForma state=\\\"permitCreate\\\" {appselected} on:update={getAllUpdatedTask} on:close={toggleTaskForm} />\\r\\n  {/if}\\r\\n\\r\\n  {#if createPlan}\\r\\n    <CreatePlan apps={[\\\"allapps\\\", ...apps]} on:update={async() => await fetchplansbyapp()} on:close={closeCreatePlan} {appselected} />\\r\\n  {/if}\\r\\n\\r\\n  <div class=\\\"right\\\">\\r\\n    <div class=\\\"state\\\">\\r\\n      <div class=\\\"header\\\" style=\\\"background-color: {openColor}\\\">\\r\\n        <p>Open</p>\\r\\n      </div>\\r\\n      {#if showcreatetaskB && appselected !== \\\"allapps\\\"}\\r\\n      <div class=\\\"button-task\\\">\\r\\n        <Button on:click={toggleTaskForm}>Create Task</Button>\\r\\n      </div>\\r\\n      {/if}\\r\\n      <div class=\\\"task-container\\\">\\r\\n      {#each filteredtask as t}\\r\\n        {#if t.taskstate == \\\"open\\\"}\\r\\n          <Task\\r\\n          key={t.taskid}\\r\\n            {filteredplans}\\r\\n            state=\\\"permitOpen\\\"\\r\\n            task={t}\\r\\n            stateColor={openColor}\\r\\n            on:update={getAllUpdatedTask}\\r\\n          />\\r\\n        {/if}\\r\\n      {/each}\\r\\n    </div>\\r\\n    </div>\\r\\n\\r\\n    <div class=\\\"state\\\">\\r\\n      <div class=\\\"header\\\" style=\\\"background-color: {todoColor}\\\">\\r\\n        <p>To Do</p>\\r\\n      </div>\\r\\n      <div class=\\\"task-container\\\">\\r\\n      {#each filteredtask as t}\\r\\n        {#if t.taskstate == \\\"todo\\\"}\\r\\n          <Task\\r\\n          key={t.taskid}\\r\\n            {filteredplans}\\r\\n            state=\\\"permitTodo\\\"\\r\\n            task={t}\\r\\n            stateColor={todoColor}\\r\\n            on:update={getAllUpdatedTask}\\r\\n          />\\r\\n        {/if}\\r\\n      {/each}\\r\\n      </div>\\r\\n    </div>\\r\\n\\r\\n    <div class=\\\"state\\\">\\r\\n      <div class=\\\"header\\\" style=\\\"background-color: {doingColor}\\\">\\r\\n        <p>Doing</p>\\r\\n      </div>\\r\\n      <div class=\\\"task-container\\\">\\r\\n      {#each filteredtask as t}\\r\\n        {#if t.taskstate == \\\"doing\\\"}\\r\\n          <Task\\r\\n            key={t.taskid}\\r\\n            {filteredplans}\\r\\n            state=\\\"permitDoing\\\"\\r\\n            task={t}\\r\\n            stateColor={doingColor}\\r\\n            on:update={getAllUpdatedTask}\\r\\n          />\\r\\n        {/if}\\r\\n      {/each}\\r\\n      </div>\\r\\n    </div>\\r\\n\\r\\n    <div class=\\\"state\\\">\\r\\n      <div class=\\\"header\\\" style=\\\"background-color: {doneColor}\\\">\\r\\n        <p>Done</p>\\r\\n      </div>\\r\\n      <div class=\\\"task-container\\\">\\r\\n      {#each filteredtask as t}\\r\\n        {#if t.taskstate == \\\"done\\\"}\\r\\n          <Task\\r\\n          key={t.taskid}\\r\\n            {filteredplans}\\r\\n            state=\\\"permitDone\\\"\\r\\n            task={t}\\r\\n            stateColor={doneColor}\\r\\n            on:update={getAllUpdatedTask}\\r\\n          />\\r\\n        {/if}\\r\\n      {/each}\\r\\n      </div>\\r\\n    </div>\\r\\n\\r\\n    <div class=\\\"state\\\">\\r\\n      <div class=\\\"header\\\" style=\\\"background-color: {closeColor}\\\">\\r\\n        <p>Close</p>\\r\\n      </div>\\r\\n      <div class=\\\"task-container\\\">\\r\\n      {#each filteredtask as t}\\r\\n        {#if t.taskstate == \\\"closed\\\"}\\r\\n          <Task\\r\\n          key={t.taskid}\\r\\n            {filteredplans}\\r\\n            task={t}\\r\\n            stateColor={closeColor}\\r\\n            on:update={getAllUpdatedTask}\\r\\n          />\\r\\n        {/if}\\r\\n      {/each}\\r\\n      </div>\\r\\n    </div>\\r\\n  </div>\\r\\n</main>\\r\\n\\r\\n<style>\\r\\n  .container {\\r\\n    display: flex;\\r\\n    width: 100vw;\\r\\n    min-height: 91vh;\\r\\n    overflow-y: hidden;\\r\\n    overflow-x: hidden;\\r\\n    font-family: sans-serif;\\r\\n    font-size: 0.8rem;\\r\\n  }\\r\\n\\r\\n  .left-sidebar {\\r\\n    display: flex;\\r\\n    flex-direction: column;\\r\\n    background-color: #5e91cb;\\r\\n    width: 15vw;\\r\\n    height: 91vh;\\r\\n  }\\r\\n\\r\\n  .left-section {\\r\\n    padding: 0.5rem;\\r\\n    margin: 0.5rem;\\r\\n    border-radius: 8px;\\r\\n    border: 3px solid var(--main-color);\\r\\n    height: 45%;\\r\\n    background-color: #fff;\\r\\n    margin-bottom: 15px;\\r\\n    box-shadow: 0px 3px 8px rgba(0, 0, 0, 0.45);\\r\\n    overflow: auto;\\r\\n  }\\r\\n\\r\\n  .left-section p {\\r\\n    text-align: center;\\r\\n    margin-bottom: 0.4rem;\\r\\n    font-weight: bold;\\r\\n  }\\r\\n\\r\\n  .right {\\r\\n    display: flex;\\r\\n    width: 85vw;\\r\\n    height: 91vh;\\r\\n  }\\r\\n  .state {\\r\\n    border-right: 2px solid #cecece;\\r\\n    height: 100%;\\r\\n    width: 20%;\\r\\n    padding: 10px;\\r\\n  }\\r\\n\\r\\n  .header {\\r\\n    width: 100%;\\r\\n    height: 5%;\\r\\n    display: flex;\\r\\n    align-items: center;\\r\\n    justify-content: center;\\r\\n    border-bottom: 1px solid #cecece;\\r\\n    border-radius: 15px;\\r\\n    font-family: sans-serif;\\r\\n    box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.45);\\r\\n    margin-bottom: 15px;\\r\\n  }\\r\\n  .header p {\\r\\n    font-size: 22px;\\r\\n    font-weight: 500;\\r\\n  }\\r\\n  .button-center {\\r\\n    text-align: center;\\r\\n  }\\r\\n  .button-task {\\r\\n    margin: 1rem;\\r\\n    text-align: center;\\r\\n  }\\r\\n\\r\\n  .task-container {\\r\\n    overflow-y: scroll;\\r\\n    /* background-color: red;  */\\r\\n    height: 78vh;\\r\\n    padding-right: 10px;\\r\\n    /* position: absolute; */\\r\\n  }\\r\\n\\r\\n  /* width */\\r\\n::-webkit-scrollbar {\\r\\n  width: 6px;\\r\\n padding: 2px;\\r\\n}\\r\\n\\r\\n/* Track */\\r\\n::-webkit-scrollbar-track {\\r\\n  /* box-shadow: inset 0 0 5px grey; */\\r\\n  border-radius: 10px;\\r\\n \\r\\n}\\r\\n\\r\\n/* Handle */\\r\\n::-webkit-scrollbar-thumb {\\r\\n  background: grey;\\r\\n  border-radius: 10px;\\r\\n  height: 10px;\\r\\n}\\r\\n\\r\\n  /* .list {\\r\\n    font-weight: normal;\\r\\n    overflow-y: auto;\\r\\n    border: 1px solid #444;\\r\\n    margin-top: 10px;\\r\\n    \\r\\n  }\\r\\n  .list-item {\\r\\n    border: 1px solid rgb(5, 5, 5);\\r\\n    cursor: pointer;\\r\\n    color: black;\\r\\n  } */\\r\\n\\r\\n  /* .left-top div{\\r\\n    display: flex;\\r\\n    margin: 2px;\\r\\n    margin-top: 44px;\\r\\n}\\r\\n#createtaskbtn{\\r\\n    display: flex;\\r\\n    justify-content: center;\\r\\n    height: 50px;\\r\\n    margin-top: 20px;\\r\\n}\\r\\n.button-plan{\\r\\n    text-align: center;\\r\\n} */\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AA0fE,UAAU,4BAAC,CAAC,AACV,OAAO,CAAE,IAAI,CACb,KAAK,CAAE,KAAK,CACZ,UAAU,CAAE,IAAI,CAChB,UAAU,CAAE,MAAM,CAClB,UAAU,CAAE,MAAM,CAClB,WAAW,CAAE,UAAU,CACvB,SAAS,CAAE,MAAM,AACnB,CAAC,AAED,aAAa,4BAAC,CAAC,AACb,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,CACtB,gBAAgB,CAAE,OAAO,CACzB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,AACd,CAAC,AAED,aAAa,4BAAC,CAAC,AACb,OAAO,CAAE,MAAM,CACf,MAAM,CAAE,MAAM,CACd,aAAa,CAAE,GAAG,CAClB,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,YAAY,CAAC,CACnC,MAAM,CAAE,GAAG,CACX,gBAAgB,CAAE,IAAI,CACtB,aAAa,CAAE,IAAI,CACnB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAC3C,QAAQ,CAAE,IAAI,AAChB,CAAC,AAED,2BAAa,CAAC,CAAC,cAAC,CAAC,AACf,UAAU,CAAE,MAAM,CAClB,aAAa,CAAE,MAAM,CACrB,WAAW,CAAE,IAAI,AACnB,CAAC,AAED,MAAM,4BAAC,CAAC,AACN,OAAO,CAAE,IAAI,CACb,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,AACd,CAAC,AACD,MAAM,4BAAC,CAAC,AACN,YAAY,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,CAC/B,MAAM,CAAE,IAAI,CACZ,KAAK,CAAE,GAAG,CACV,OAAO,CAAE,IAAI,AACf,CAAC,AAED,OAAO,4BAAC,CAAC,AACP,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,EAAE,CACV,OAAO,CAAE,IAAI,CACb,WAAW,CAAE,MAAM,CACnB,eAAe,CAAE,MAAM,CACvB,aAAa,CAAE,GAAG,CAAC,KAAK,CAAC,OAAO,CAChC,aAAa,CAAE,IAAI,CACnB,WAAW,CAAE,UAAU,CACvB,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,IAAI,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CAC5C,aAAa,CAAE,IAAI,AACrB,CAAC,AACD,qBAAO,CAAC,CAAC,cAAC,CAAC,AACT,SAAS,CAAE,IAAI,CACf,WAAW,CAAE,GAAG,AAClB,CAAC,AACD,cAAc,4BAAC,CAAC,AACd,UAAU,CAAE,MAAM,AACpB,CAAC,AACD,YAAY,4BAAC,CAAC,AACZ,MAAM,CAAE,IAAI,CACZ,UAAU,CAAE,MAAM,AACpB,CAAC,AAED,eAAe,4BAAC,CAAC,AACf,UAAU,CAAE,MAAM,CAElB,MAAM,CAAE,IAAI,CACZ,aAAa,CAAE,IAAI,AAErB,CAAC,4BAGH,mBAAmB,AAAC,CAAC,AACnB,KAAK,CAAE,GAAG,CACX,OAAO,CAAE,GAAG,AACb,CAAC,4BAGD,yBAAyB,AAAC,CAAC,AAEzB,aAAa,CAAE,IAAI,AAErB,CAAC,4BAGD,yBAAyB,AAAC,CAAC,AACzB,UAAU,CAAE,IAAI,CAChB,aAAa,CAAE,IAAI,CACnB,MAAM,CAAE,IAAI,AACd,CAAC\"}"
};

let openColor = "#e7d3ec";
let todoColor = "#e1e157";
let doingColor = "#e2bb74";
let doneColor = "#c2e5ae";
let closeColor = "#f1a99b";

const DashboardContent = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $$unsubscribe_applicationMethods;
	$$unsubscribe_applicationMethods = subscribe(applicationMethods, value => value);
	let showcreatetaskB = false;
	let showcreateappB = false;
	let initialtask = [];
	let filteredtask = [];
	let appData = [];
	let apps = [];
	let plans = [];
	let filteredplans = [];
	let appselected = "allapps";
	let planselected = "allplans";

	onMount(async () => {
		// await fetchtask()
		// await Promise.all([fetchtask, fetchApps])
		await fetchApps();

		await fetchplans();
		addAppPermissionData();
		addappplanColor(apps, plans);
		fetchtask();
		createAppPermission();
	});

	const fetchtask = () => {
		return new Promise((resolve, reject) => {
				const url = "http://localhost:8080/getalltask";

				fetch(url, {
					method: "POST",
					body: JSON.stringify({ editor: sessionStorage.getItem("JWT") })
				}).then(response => response.json()).then(data => {
					initialtask = data;
					filteredtask = initialtask;
					resolve();
				}).catch(err => {
					console.log(err);
				});
			});
	};

	function addappplanColor(apps, plans) {
		for (let i = 0; i < apps.length; i++) {
			appcolorMethods.addAppColors(apps[i]);
		}

		for (let i = 0; i < plans.length; i++) {
			appcolorMethods.addPlanColors(plans[i]);
		}
	}

	const unsubscribeAppPermission = applicationMethods.subscribe(application => application);

	function addAppPermissionData() {
		for (let i = 0; i < appData.length; i++) {
			let app = {};
			app["appname"] = appData[i]["appacronym"];
			app["permitCreate"] = appData[i]["permitcreate"];
			app["permitOpen"] = appData[i]["permitopen"];
			app["permitTodo"] = appData[i]["permittodo"];
			app["permitDoing"] = appData[i]["permitdoing"];
			app["permitDone"] = appData[i]["permitdone"];
			applicationMethods.addApplication(app);
		}
	}

	onDestroy(() => {
		unsubscribeAppPermission();
	});

	const fetchApps = () => {
		return new Promise((resolve, reject) => {
				const url = "http://localhost:8080/fetchapps";

				fetch(url, {
					method: "POST",
					body: JSON.stringify({ editor: sessionStorage.getItem("JWT") })
				}).then(response => response.json()).then(data => {
					appData = data;
					apps = data.map(app => app.appacronym);
					resolve();
				}).catch(err => {
					console.log(err);
				});
			});
	};

	const fetchplans = () => {
		return new Promise((resolve, reject) => {
				const url = "http://localhost:8080/getallplan";

				fetch(url, {
					method: "POST",
					body: JSON.stringify({ editor: sessionStorage.getItem("JWT") })
				}).then(response => response.json()).then(data => {
					plans = data.map(plan => plan.planname);
					resolve();
				}).catch(err => {
					console.log(err);
				});
			});
	};

	const checkGroup = (token, group, type) => {
		const url = "http://localhost:8080/authorize";

		fetch(url, {
			method: "POST",
			body: JSON.stringify({ token, group })
		}).then(response => response.json()).then(data => {
			if (data.Message === "true") {
				if (type === "task") {
					showcreatetaskB = true;
				} else if (type === "plan") ; else if (type === "app") {
					showcreateappB = true;
				}
			} else {
				if (type === "task") {
					showcreatetaskB = false;
				}
			}
		}).catch(error => {
			console.log(error);
		});
	};

	const createAppPermission = () => {
		checkGroup(sessionStorage.getItem("JWT"), "configmanager", "app");
	};

	$$result.css.add(css$3);
	$$unsubscribe_applicationMethods();

	return `<main class="${"container svelte-w8pctw"}"><div class="${"left-sidebar svelte-w8pctw"}"><div class="${"left-section svelte-w8pctw"}"><p class="${"svelte-w8pctw"}">Applications</p>

      <div class="${"button-center svelte-w8pctw"}">${showcreateappB
	? `${validate_component(Button, "Button").$$render(
			$$result,
			{
				id: "newapp",
				size: "sm",
				mode: "outline"
			},
			{},
			{
				default: () => {
					return `New App`;
				}
			}
		)}`
	: ``}
        ${showcreateappB && appselected !== "allapps"
	? `${validate_component(Button, "Button").$$render(
			$$result,
			{
				id: "editapp",
				size: "sm",
				mode: "outline"
			},
			{},
			{
				default: () => {
					return `Edit App`;
				}
			}
		)}`
	: ``}</div>
      ${validate_component(ScrollingList, "ScrollingList").$$render(
		$$result,
		{
			arr: ["allapps", ...apps],
			type: "application",
			appselected,
			planselected
		},
		{},
		{}
	)}</div>
    ${``}</div>

  ${``}

  ${``}

  ${``}

  <div class="${"right svelte-w8pctw"}"><div class="${"state svelte-w8pctw"}"><div class="${"header svelte-w8pctw"}" style="${"background-color: " + escape(openColor, true)}"><p class="${"svelte-w8pctw"}">Open</p></div>
      ${showcreatetaskB && appselected !== "allapps"
	? `<div class="${"button-task svelte-w8pctw"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
			default: () => {
				return `Create Task`;
			}
		})}</div>`
	: ``}
      <div class="${"task-container svelte-w8pctw"}">${each(filteredtask, t => {
		return `${t.taskstate == "open"
		? `${validate_component(Task, "Task").$$render(
				$$result,
				{
					key: t.taskid,
					filteredplans,
					state: "permitOpen",
					task: t,
					stateColor: openColor
				},
				{},
				{}
			)}`
		: ``}`;
	})}</div></div>

    <div class="${"state svelte-w8pctw"}"><div class="${"header svelte-w8pctw"}" style="${"background-color: " + escape(todoColor, true)}"><p class="${"svelte-w8pctw"}">To Do</p></div>
      <div class="${"task-container svelte-w8pctw"}">${each(filteredtask, t => {
		return `${t.taskstate == "todo"
		? `${validate_component(Task, "Task").$$render(
				$$result,
				{
					key: t.taskid,
					filteredplans,
					state: "permitTodo",
					task: t,
					stateColor: todoColor
				},
				{},
				{}
			)}`
		: ``}`;
	})}</div></div>

    <div class="${"state svelte-w8pctw"}"><div class="${"header svelte-w8pctw"}" style="${"background-color: " + escape(doingColor, true)}"><p class="${"svelte-w8pctw"}">Doing</p></div>
      <div class="${"task-container svelte-w8pctw"}">${each(filteredtask, t => {
		return `${t.taskstate == "doing"
		? `${validate_component(Task, "Task").$$render(
				$$result,
				{
					key: t.taskid,
					filteredplans,
					state: "permitDoing",
					task: t,
					stateColor: doingColor
				},
				{},
				{}
			)}`
		: ``}`;
	})}</div></div>

    <div class="${"state svelte-w8pctw"}"><div class="${"header svelte-w8pctw"}" style="${"background-color: " + escape(doneColor, true)}"><p class="${"svelte-w8pctw"}">Done</p></div>
      <div class="${"task-container svelte-w8pctw"}">${each(filteredtask, t => {
		return `${t.taskstate == "done"
		? `${validate_component(Task, "Task").$$render(
				$$result,
				{
					key: t.taskid,
					filteredplans,
					state: "permitDone",
					task: t,
					stateColor: doneColor
				},
				{},
				{}
			)}`
		: ``}`;
	})}</div></div>

    <div class="${"state svelte-w8pctw"}"><div class="${"header svelte-w8pctw"}" style="${"background-color: " + escape(closeColor, true)}"><p class="${"svelte-w8pctw"}">Close</p></div>
      <div class="${"task-container svelte-w8pctw"}">${each(filteredtask, t => {
		return `${t.taskstate == "closed"
		? `${validate_component(Task, "Task").$$render(
				$$result,
				{
					key: t.taskid,
					filteredplans,
					task: t,
					stateColor: closeColor
				},
				{},
				{}
			)}`
		: ``}`;
	})}</div></div></div>
</main>`;
});

/* src\page\Dashboard.svelte generated by Svelte v3.50.1 */

const Dashboard = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<main>${validate_component(Navbar, "Navbar").$$render($$result, {}, {}, {})}
    ${validate_component(DashboardContent, "DashboardContent").$$render($$result, {}, {}, {})}</main>

`;
});

// Firefox lacks support for scrollIntoViewIfNeeded, see
// https://github.com/janosh/svelte-multiselect/issues/87
// this polyfill was copied from
// https://github.com/nuxodin/lazyfill/blob/a8e63/polyfills/Element/prototype/scrollIntoViewIfNeeded.js
if (typeof Element !== `undefined` &&
    !Element.prototype?.scrollIntoViewIfNeeded) {
    Element.prototype.scrollIntoViewIfNeeded = function (centerIfNeeded = true) {
        const el = this;
        new IntersectionObserver(function ([entry]) {
            const ratio = entry.intersectionRatio;
            if (ratio < 1) {
                const place = ratio <= 0 && centerIfNeeded ? `center` : `nearest`;
                el.scrollIntoView({
                    block: place,
                    inline: place,
                });
            }
            this.disconnect();
        }).observe(this);
    };
}

/* src\components\AllUser.svelte generated by Svelte v3.50.1 */

const css$2 = {
	code: "table.svelte-4a2wcm,tr.svelte-4a2wcm,td.svelte-4a2wcm,th.svelte-4a2wcm{font-family:sans-serif;table-layout:auto;text-align:center;border-collapse:collapse}table.svelte-4a2wcm{box-shadow:1px 1px 3px rgba(0, 0, 0, 0.26)}th.svelte-4a2wcm{background-color:var(--main-dark-color);color:var(--font-light-color)}td.svelte-4a2wcm{min-width:15vw;padding:0 0.5rem}.allow.svelte-4a2wcm{color:var(--success-color)}.notAllow.svelte-4a2wcm{color:var(--danger-color)}.createDiv.svelte-4a2wcm{width:100vw;padding-top:15px;padding-bottom:15px;display:flex;justify-content:center}.alt-row.svelte-4a2wcm{background-color:var(--background-light-color)}",
	map: "{\"version\":3,\"file\":\"AllUser.svelte\",\"sources\":[\"AllUser.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import { onMount } from \\\"svelte\\\";\\r\\n  import EditUser from \\\"../components/EditUser.svelte\\\";\\r\\n  import Button from \\\"../UI/Button.svelte\\\";\\r\\n  import { navigate } from \\\"svelte-routing\\\";\\r\\n  import CreateUser from \\\"./CreateUser.svelte\\\";\\r\\n  let createBar = false;\\r\\n  let editForm = false;\\r\\n  let userlist = [];\\r\\n  let grouplist = [];\\r\\n  let currentUser;\\r\\n\\r\\n  onMount(() => {\\r\\n    getAllUser();\\r\\n    getAllGroups();\\r\\n  });\\r\\n\\r\\n  async function getAllUser() {\\r\\n    const url = \\\"http://localhost:8080/fetchusers\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        token: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        userlist = data;\\r\\n        if (userlist.Message === \\\"You are not allow to view this page\\\") {\\r\\n          navigate(\\\"/dashboard\\\");\\r\\n        }\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  }\\r\\n\\r\\n  async function getAllGroups() {\\r\\n    const url = \\\"http://localhost:8080/fetchgroups\\\";\\r\\n    fetch(url)\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        const dataArr = data.map((grp) => grp.groupname);\\r\\n        grouplist = dataArr;\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  }\\r\\n\\r\\n  function edituser(username) {\\r\\n    const url = \\\"http://localhost:8080/fetchuser\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        username: username,\\r\\n        editor: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        currentUser = data;\\r\\n        editForm = true;\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  }\\r\\n\\r\\n  function closeEditUser() {\\r\\n    getAllUser();\\r\\n    editForm = false;\\r\\n  }\\r\\n  const showCreate = () => {\\r\\n    createBar = true;\\r\\n  };\\r\\n  const closeCreate = () => {\\r\\n    getAllUser();\\r\\n    createBar = false;\\r\\n  };\\r\\n\\r\\n</script>\\r\\n\\r\\n<div class=\\\"page-container\\\">\\r\\n  {#if createBar}\\r\\n    <CreateUser on:close={closeCreate} on:submit={()=>getAllUser()} users={userlist} />\\r\\n  {:else}\\r\\n    <div class=\\\"createDiv\\\">\\r\\n      <Button on:click={showCreate}>Create User</Button>\\r\\n    </div>\\r\\n  {/if}\\r\\n  <table>\\r\\n    <thead>\\r\\n      <tr>\\r\\n        <th>Name</th>\\r\\n        <th>Email</th>\\r\\n        <th>Status</th>\\r\\n        <th>Groups</th>\\r\\n        <th>Edit</th>\\r\\n      </tr>\\r\\n    </thead>\\r\\n    {#each userlist as user, i}\\r\\n      <tbody>\\r\\n        <tr class={i % 2 === 0 && \\\"alt-row\\\"}>\\r\\n          <td>{user.username}</td>\\r\\n          <td>{user.email}</td>\\r\\n          {#if user.status}\\r\\n            <td class=\\\"allow\\\">{user.status}</td>\\r\\n          {:else}\\r\\n            <td class=\\\"notAllow\\\">{user.status}</td>\\r\\n          {/if}\\r\\n          <td>{user.belongsTo}</td>\\r\\n          <td\\r\\n            ><Button size=\\\"sm\\\" mode=\\\"outline\\\" on:click={edituser(user.username)}\\r\\n              >Edit</Button\\r\\n            ></td\\r\\n          >\\r\\n        </tr>\\r\\n      </tbody>\\r\\n    {/each}\\r\\n  </table>\\r\\n\\r\\n  {#if editForm}\\r\\n    <EditUser on:close={closeEditUser} userlist={currentUser} {grouplist} />\\r\\n  {/if}\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n table,\\r\\n  tr,\\r\\n  td,\\r\\n  th {\\r\\n    font-family: sans-serif;\\r\\n    table-layout: auto;\\r\\n    text-align: center;\\r\\n    border-collapse: collapse;\\r\\n  }\\r\\n\\r\\n  table {\\r\\n    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);\\r\\n  }\\r\\n\\r\\n  th {\\r\\n    background-color: var(--main-dark-color);\\r\\n    color: var(--font-light-color);\\r\\n  }\\r\\n\\r\\n  td {\\r\\n    min-width: 15vw;\\r\\n    padding: 0 0.5rem;\\r\\n  }\\r\\n\\r\\n\\r\\n  .allow {\\r\\n    color: var(--success-color);\\r\\n  }\\r\\n\\r\\n  .notAllow {\\r\\n    color: var(--danger-color);\\r\\n  }\\r\\n\\r\\n  .createDiv {\\r\\n    width: 100vw;\\r\\n    padding-top: 15px;\\r\\n    padding-bottom: 15px;\\r\\n    display: flex;\\r\\n    justify-content: center;\\r\\n  }\\r\\n\\r\\n  .alt-row {\\r\\n    background-color: var(--background-light-color);\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAgIC,mBAAK,CACJ,gBAAE,CACF,gBAAE,CACF,EAAE,cAAC,CAAC,AACF,WAAW,CAAE,UAAU,CACvB,YAAY,CAAE,IAAI,CAClB,UAAU,CAAE,MAAM,CAClB,eAAe,CAAE,QAAQ,AAC3B,CAAC,AAED,KAAK,cAAC,CAAC,AACL,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAC7C,CAAC,AAED,EAAE,cAAC,CAAC,AACF,gBAAgB,CAAE,IAAI,iBAAiB,CAAC,CACxC,KAAK,CAAE,IAAI,kBAAkB,CAAC,AAChC,CAAC,AAED,EAAE,cAAC,CAAC,AACF,SAAS,CAAE,IAAI,CACf,OAAO,CAAE,CAAC,CAAC,MAAM,AACnB,CAAC,AAGD,MAAM,cAAC,CAAC,AACN,KAAK,CAAE,IAAI,eAAe,CAAC,AAC7B,CAAC,AAED,SAAS,cAAC,CAAC,AACT,KAAK,CAAE,IAAI,cAAc,CAAC,AAC5B,CAAC,AAED,UAAU,cAAC,CAAC,AACV,KAAK,CAAE,KAAK,CACZ,WAAW,CAAE,IAAI,CACjB,cAAc,CAAE,IAAI,CACpB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,AACzB,CAAC,AAED,QAAQ,cAAC,CAAC,AACR,gBAAgB,CAAE,IAAI,wBAAwB,CAAC,AACjD,CAAC\"}"
};

const AllUser = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let userlist = [];

	onMount(() => {
		getAllUser();
		getAllGroups();
	});

	async function getAllUser() {
		const url = "http://localhost:8080/fetchusers";

		fetch(url, {
			method: "POST",
			body: JSON.stringify({ token: sessionStorage.getItem("JWT") })
		}).then(response => response.json()).then(data => {
			userlist = data;

			if (userlist.Message === "You are not allow to view this page") {
				navigate("/dashboard");
			}
		}).catch(error => {
			console.log(error);
		});
	}

	async function getAllGroups() {
		const url = "http://localhost:8080/fetchgroups";

		fetch(url).then(response => response.json()).then(data => {
			data.map(grp => grp.groupname);
		}).catch(error => {
			console.log(error);
		});
	}

	$$result.css.add(css$2);

	return `<div class="${"page-container"}">${`<div class="${"createDiv svelte-4a2wcm"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
			default: () => {
				return `Create User`;
			}
		})}</div>`}
  <table class="${"svelte-4a2wcm"}"><thead><tr class="${"svelte-4a2wcm"}"><th class="${"svelte-4a2wcm"}">Name</th>
        <th class="${"svelte-4a2wcm"}">Email</th>
        <th class="${"svelte-4a2wcm"}">Status</th>
        <th class="${"svelte-4a2wcm"}">Groups</th>
        <th class="${"svelte-4a2wcm"}">Edit</th></tr></thead>
    ${each(userlist, (user, i) => {
		return `<tbody><tr class="${escape(null_to_empty(i % 2 === 0 && "alt-row"), true) + " svelte-4a2wcm"}"><td class="${"svelte-4a2wcm"}">${escape(user.username)}</td>
          <td class="${"svelte-4a2wcm"}">${escape(user.email)}</td>
          ${user.status
		? `<td class="${"allow svelte-4a2wcm"}">${escape(user.status)}</td>`
		: `<td class="${"notAllow svelte-4a2wcm"}">${escape(user.status)}</td>`}
          <td class="${"svelte-4a2wcm"}">${escape(user.belongsTo)}</td>
          <td class="${"svelte-4a2wcm"}">${validate_component(Button, "Button").$$render($$result, { size: "sm", mode: "outline" }, {}, {
			default: () => {
				return `Edit`;
			}
		})}</td></tr>
      </tbody>`;
	})}</table>

  ${``}
</div>`;
});

/* src\page\UserManagement.svelte generated by Svelte v3.50.1 */

const UserManagement = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<main>${validate_component(Navbar, "Navbar").$$render($$result, {}, {}, {})}
  ${validate_component(AllUser, "AllUser").$$render($$result, {}, {}, {})}</main>`;
});

/* src\components\ProfileContent.svelte generated by Svelte v3.50.1 */

const css$1 = {
	code: "main.svelte-129bvhm{font-family:sans-serif;width:100%;display:flex;justify-content:center}.input-wrapper.svelte-129bvhm{font-family:sans-serif;display:flex;justify-content:center;column-gap:1rem;width:100%}h2.svelte-129bvhm{text-align:center}.submit-btn.svelte-129bvhm{bottom:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:center}.section.svelte-129bvhm{margin:1rem 0}",
	map: "{\"version\":3,\"file\":\"ProfileContent.svelte\",\"sources\":[\"ProfileContent.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import Button from \\\"../UI/Button.svelte\\\";\\r\\n  import TextInput from \\\"../UI/TextInput.svelte\\\";\\r\\n\\r\\n  let password = \\\"\\\";\\r\\n  let email = \\\"\\\";\\r\\n  let passworderrormsg = \\\"\\\";\\r\\n  let emailerrormsg = \\\"\\\";\\r\\n  // let passwordValid = false;\\r\\n  // let emailValid = false;\\r\\n\\r\\n  // $: passwordValid = validatePassword(password)\\r\\n  // $: emailValid = validateEmail(email)\\r\\n\\r\\n  function validatePassword(password) {\\r\\n    var passwordRegEx =\\r\\n      /^(?=.*[a-zA-Z])(?=.*\\\\d)(?=.*[!@#$%^&*()_+])[A-Za-z\\\\d!@#$%^&*()_+]{8,10}/;\\r\\n    return passwordRegEx.test(String(password).toLowerCase());\\r\\n  }\\r\\n\\r\\n  function handlePasswordSubmission() {\\r\\n    let isValidPassword = validatePassword(password);\\r\\n    if (isValidPassword) {\\r\\n      passworderrormsg = \\\"\\\";\\r\\n      const url = \\\"http://localhost:8080/updateuserpassword\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          token: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n          password: password,\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          alert(data.Message);\\r\\n          console.log(data);\\r\\n        })\\r\\n        .catch((error) => {\\r\\n          console.log(error);\\r\\n        });\\r\\n    } else {\\r\\n      passworderrormsg = \\\"Invalid password\\\";\\r\\n      alert(passworderrormsg)\\r\\n    }\\r\\n  }\\r\\n\\r\\n  function validateEmail(email) {\\r\\n    var emailRegEx =\\r\\n      /^(([^<>()\\\\[\\\\]\\\\\\\\.,;:\\\\s@\\\"]+(\\\\.[^<>()\\\\[\\\\]\\\\\\\\.,;:\\\\s@\\\"]+)*)|(\\\".+\\\"))@((\\\\[[0-9]{1,3}\\\\.[0-9]{1,3}\\\\.[0-9]{1,3}\\\\.[0-9]{1,3}\\\\])|(([a-zA-Z\\\\-0-9]+\\\\.)+[a-zA-Z]{2,}))$/;\\r\\n    return emailRegEx.test(String(email).toLowerCase());\\r\\n  }\\r\\n\\r\\n  function handleEmailSubmission() {\\r\\n    let isValidEmail = validateEmail(email);\\r\\n    if (isValidEmail) {\\r\\n      emailerrormsg = \\\"\\\";\\r\\n      const url = \\\"http://localhost:8080/updateuseremail\\\";\\r\\n      fetch(url, {\\r\\n        method: \\\"POST\\\",\\r\\n        body: JSON.stringify({\\r\\n          token: sessionStorage.getItem(\\\"JWT\\\"),\\r\\n          email: email,\\r\\n        }),\\r\\n      })\\r\\n        .then((response) => response.json())\\r\\n        .then((data) => {\\r\\n          alert(data.Message);\\r\\n          console.log(data);\\r\\n        })\\r\\n        .catch((error) => {\\r\\n          console.log(error);\\r\\n        });\\r\\n    } else {\\r\\n      emailerrormsg = \\\"Invalid email\\\";\\r\\n      alert(emailerrormsg);\\r\\n    }\\r\\n  }\\r\\n</script>\\r\\n\\r\\n<main class=\\\"page-container\\\">\\r\\n  <div class=\\\"section\\\">\\r\\n    <h2>Edit Email</h2>\\r\\n\\r\\n    <div class=\\\"input-wrapper\\\">\\r\\n      <TextInput\\r\\n        id=\\\"email\\\"\\r\\n        type=\\\"email\\\"\\r\\n        label=\\\"New Email\\\"\\r\\n        placeholder=\\\"Enter new email\\\"\\r\\n        value={email}\\r\\n        on:input={(e) => (email = e.target.value)}\\r\\n      />\\r\\n      <div class=\\\"submit-btn\\\">\\r\\n        <Button on:click={handleEmailSubmission}>Submit</Button>\\r\\n      </div>\\r\\n    </div>\\r\\n  </div>\\r\\n\\r\\n  <div class=\\\"section\\\">\\r\\n    <h2>Edit Password</h2>\\r\\n\\r\\n    <div class=\\\"input-wrapper\\\">\\r\\n      <TextInput\\r\\n        id=\\\"password\\\"\\r\\n        type=\\\"password\\\"\\r\\n        label=\\\"New Password\\\"\\r\\n        placeholder=\\\"Enter new password\\\"\\r\\n        value={password}\\r\\n        on:input={(e) => (password = e.target.value)}\\r\\n      />\\r\\n      <div class=\\\"submit-btn\\\">\\r\\n        <Button on:click={handlePasswordSubmission}>Submit</Button>\\r\\n      </div>\\r\\n    </div>\\r\\n  </div>\\r\\n</main>\\r\\n\\r\\n<style>\\r\\n  main {\\r\\n    font-family: sans-serif;\\r\\n    width: 100%;\\r\\n    display: flex;\\r\\n    justify-content: center;\\r\\n  }\\r\\n\\r\\n  .input-wrapper {\\r\\n    font-family: sans-serif;\\r\\n    display: flex;\\r\\n    justify-content: center;\\r\\n    column-gap: 1rem;\\r\\n    width: 100%;\\r\\n  }\\r\\n\\r\\n  h2 {\\r\\n    text-align: center;\\r\\n  }\\r\\n  .submit-btn {\\r\\n    bottom: 0;\\r\\n    display: flex;\\r\\n    flex-direction: column;\\r\\n    align-items: flex-end;\\r\\n    justify-content: center;\\r\\n  }\\r\\n\\r\\n  .section {\\r\\n    margin: 1rem 0;\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAsHE,IAAI,eAAC,CAAC,AACJ,WAAW,CAAE,UAAU,CACvB,KAAK,CAAE,IAAI,CACX,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,AACzB,CAAC,AAED,cAAc,eAAC,CAAC,AACd,WAAW,CAAE,UAAU,CACvB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,CACvB,UAAU,CAAE,IAAI,CAChB,KAAK,CAAE,IAAI,AACb,CAAC,AAED,EAAE,eAAC,CAAC,AACF,UAAU,CAAE,MAAM,AACpB,CAAC,AACD,WAAW,eAAC,CAAC,AACX,MAAM,CAAE,CAAC,CACT,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,CACtB,WAAW,CAAE,QAAQ,CACrB,eAAe,CAAE,MAAM,AACzB,CAAC,AAED,QAAQ,eAAC,CAAC,AACR,MAAM,CAAE,IAAI,CAAC,CAAC,AAChB,CAAC\"}"
};

const ProfileContent = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let password = "";
	let email = "";

	$$result.css.add(css$1);

	return `<main class="${"page-container svelte-129bvhm"}"><div class="${"section svelte-129bvhm"}"><h2 class="${"svelte-129bvhm"}">Edit Email</h2>

    <div class="${"input-wrapper svelte-129bvhm"}">${validate_component(TextInput, "TextInput").$$render(
		$$result,
		{
			id: "email",
			type: "email",
			label: "New Email",
			placeholder: "Enter new email",
			value: email
		},
		{},
		{}
	)}
      <div class="${"submit-btn svelte-129bvhm"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
		default: () => {
			return `Submit`;
		}
	})}</div></div></div>

  <div class="${"section svelte-129bvhm"}"><h2 class="${"svelte-129bvhm"}">Edit Password</h2>

    <div class="${"input-wrapper svelte-129bvhm"}">${validate_component(TextInput, "TextInput").$$render(
		$$result,
		{
			id: "password",
			type: "password",
			label: "New Password",
			placeholder: "Enter new password",
			value: password
		},
		{},
		{}
	)}
      <div class="${"submit-btn svelte-129bvhm"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
		default: () => {
			return `Submit`;
		}
	})}</div></div></div>
</main>`;
});

/* src\page\Profile.svelte generated by Svelte v3.50.1 */

const Profile = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `${validate_component(Navbar, "Navbar").$$render($$result, {}, {}, {})}
${validate_component(ProfileContent, "ProfileContent").$$render($$result, {}, {}, {})}`;
});

// if the value is notempty
function isEmpty(val) {
  return val.trim().length === 0
}

/* src\components\AllGroups.svelte generated by Svelte v3.50.1 */

const css = {
	code: "table.svelte-19y6orm.svelte-19y6orm,tr.svelte-19y6orm.svelte-19y6orm,td.svelte-19y6orm.svelte-19y6orm,th.svelte-19y6orm.svelte-19y6orm{font-family:sans-serif;table-layout:auto;text-align:center;border-collapse:collapse}table.svelte-19y6orm.svelte-19y6orm{box-shadow:1px 1px 3px rgba(0, 0, 0, 0.26)}th.svelte-19y6orm.svelte-19y6orm{background-color:var(--main-dark-color);color:var(--font-light-color)}td.svelte-19y6orm.svelte-19y6orm{min-width:15vw;padding:0 0.5rem}.page-container.svelte-19y6orm.svelte-19y6orm{display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%}.createDiv.svelte-19y6orm.svelte-19y6orm{width:100vw;padding-top:15px;padding-bottom:15px;display:flex;justify-content:center}.add-group.svelte-19y6orm.svelte-19y6orm{font-family:sans-serif;display:flex;justify-content:center;column-gap:1rem;width:50%;padding:0.5rem 2rem}.create-group-btn.svelte-19y6orm.svelte-19y6orm{width:100%;bottom:0;display:flex;align-items:flex-end;justify-content:center}.create-group-btn.svelte-19y6orm>.svelte-19y6orm{margin:0.5rem}.alt-row.svelte-19y6orm.svelte-19y6orm{background-color:var(--background-light-color)}",
	map: "{\"version\":3,\"file\":\"AllGroups.svelte\",\"sources\":[\"AllGroups.svelte\"],\"sourcesContent\":[\"<script>\\r\\n  import { onMount } from \\\"svelte\\\";\\r\\n  import { isEmpty } from \\\"../utils/validation\\\";\\r\\n  import Button from \\\"../UI/Button.svelte\\\";\\r\\n  import TextInput from \\\"../UI/TextInput.svelte\\\";\\r\\n\\r\\n  let grouplist = [];\\r\\n  let groupname = \\\"\\\";\\r\\n  let editForm = false;\\r\\n\\r\\n  let groupnameValid = false;\\r\\n\\r\\n  $: groupnameValid = !isEmpty(groupname);\\r\\n\\r\\n  onMount(() => {\\r\\n    getAllGroups();\\r\\n  });\\r\\n\\r\\n  async function getAllGroups() {\\r\\n    const url = \\\"http://localhost:8080/fetchgroups\\\";\\r\\n    fetch(url)\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        const dataArr = data.map((grp) => grp.groupname);\\r\\n        grouplist = dataArr;\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  }\\r\\n\\r\\n  const createGroup = (e) => {\\r\\n    e.preventDefault();\\r\\n    if (!groupname.length) {\\r\\n      alert(\\\"Group name cannot be empty.\\\");\\r\\n      return;\\r\\n    }\\r\\n    const url = \\\"http://localhost:8080/creategroup\\\";\\r\\n    fetch(url, {\\r\\n      method: \\\"POST\\\",\\r\\n      body: JSON.stringify({\\r\\n        groupname: groupname,\\r\\n      }),\\r\\n    })\\r\\n      .then((response) => response.json())\\r\\n      .then((data) => {\\r\\n        alert(data[0].Message);\\r\\n        groupname = \\\"\\\";\\r\\n        getAllGroups();\\r\\n      })\\r\\n      .catch((error) => {\\r\\n        console.log(error);\\r\\n      });\\r\\n  };\\r\\n\\r\\n  const toggleEditForm = () => {\\r\\n    editForm = !editForm;\\r\\n  };\\r\\n</script>\\r\\n\\r\\n<main>\\r\\n  <div class=\\\"page-container\\\">\\r\\n    {#if editForm}\\r\\n      <form on:submit|preventDefault={createGroup} class=\\\"add-group\\\">\\r\\n        <TextInput\\r\\n          id=\\\"groupname\\\"\\r\\n          label=\\\"Group name\\\"\\r\\n          placeholder=\\\"Enter group name\\\"\\r\\n          value={groupname}\\r\\n          on:input={(e) => (groupname = e.target.value)}\\r\\n        />\\r\\n        <div class=\\\"create-group-btn\\\">\\r\\n          <div>\\r\\n            <Button type=\\\"submit\\\" mode=\\\"outline\\\">Add Group</Button>\\r\\n          </div>\\r\\n          <div>\\r\\n            <Button on:click={toggleEditForm} mode=\\\"outline\\\">Close</Button>\\r\\n          </div>\\r\\n        </div>\\r\\n      </form>\\r\\n    {:else}\\r\\n      <div class=\\\"createDiv\\\">\\r\\n        <Button on:click={toggleEditForm}>Create Group</Button>\\r\\n      </div>\\r\\n    {/if}\\r\\n\\r\\n    <table>\\r\\n      <thead>\\r\\n        <tr>\\r\\n          <th>S/N</th>\\r\\n          <th>Name</th>\\r\\n        </tr>\\r\\n      </thead>\\r\\n      <tbody>\\r\\n        {#each grouplist as group, i}\\r\\n          <tr class={i % 2 === 0 && \\\"alt-row\\\"}>\\r\\n            <td>{i + 1}</td>\\r\\n            <td>{group}</td>\\r\\n          </tr>\\r\\n        {/each}\\r\\n      </tbody>\\r\\n    </table>\\r\\n  </div>\\r\\n</main>\\r\\n\\r\\n<style>\\r\\n  table,\\r\\n  tr,\\r\\n  td,\\r\\n  th {\\r\\n    font-family: sans-serif;\\r\\n    table-layout: auto;\\r\\n    text-align: center;\\r\\n    border-collapse: collapse;\\r\\n  }\\r\\n\\r\\n  table {\\r\\n    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);\\r\\n  }\\r\\n\\r\\n  th {\\r\\n    background-color: var(--main-dark-color);\\r\\n    color: var(--font-light-color);\\r\\n  }\\r\\n\\r\\n  td {\\r\\n    min-width: 15vw;\\r\\n    padding: 0 0.5rem;\\r\\n  }\\r\\n\\r\\n  .page-container {\\r\\n    display: flex;\\r\\n    flex-direction: column;\\r\\n    justify-content: center;\\r\\n    align-items: center;\\r\\n    width: 100%;\\r\\n  }\\r\\n\\r\\n  .createDiv {\\r\\n    width: 100vw;\\r\\n    padding-top: 15px;\\r\\n    padding-bottom: 15px;\\r\\n    display: flex;\\r\\n    justify-content: center;\\r\\n  }\\r\\n\\r\\n  .add-group {\\r\\n    font-family: sans-serif;\\r\\n    display: flex;\\r\\n    justify-content: center;\\r\\n    column-gap: 1rem;\\r\\n    width: 50%;\\r\\n    padding: 0.5rem 2rem;\\r\\n  }\\r\\n\\r\\n  .create-group-btn {\\r\\n    width: 100%;\\r\\n    bottom: 0;\\r\\n    display: flex;\\r\\n    align-items: flex-end;\\r\\n    justify-content: center;\\r\\n  }\\r\\n\\r\\n  .create-group-btn > * {\\r\\n    margin: 0.5rem;\\r\\n  }\\r\\n\\r\\n  .alt-row {\\r\\n    background-color: var(--background-light-color);\\r\\n  }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AA0GE,mCAAK,CACL,gCAAE,CACF,gCAAE,CACF,EAAE,8BAAC,CAAC,AACF,WAAW,CAAE,UAAU,CACvB,YAAY,CAAE,IAAI,CAClB,UAAU,CAAE,MAAM,CAClB,eAAe,CAAE,QAAQ,AAC3B,CAAC,AAED,KAAK,8BAAC,CAAC,AACL,UAAU,CAAE,GAAG,CAAC,GAAG,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AAC7C,CAAC,AAED,EAAE,8BAAC,CAAC,AACF,gBAAgB,CAAE,IAAI,iBAAiB,CAAC,CACxC,KAAK,CAAE,IAAI,kBAAkB,CAAC,AAChC,CAAC,AAED,EAAE,8BAAC,CAAC,AACF,SAAS,CAAE,IAAI,CACf,OAAO,CAAE,CAAC,CAAC,MAAM,AACnB,CAAC,AAED,eAAe,8BAAC,CAAC,AACf,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,CACtB,eAAe,CAAE,MAAM,CACvB,WAAW,CAAE,MAAM,CACnB,KAAK,CAAE,IAAI,AACb,CAAC,AAED,UAAU,8BAAC,CAAC,AACV,KAAK,CAAE,KAAK,CACZ,WAAW,CAAE,IAAI,CACjB,cAAc,CAAE,IAAI,CACpB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,AACzB,CAAC,AAED,UAAU,8BAAC,CAAC,AACV,WAAW,CAAE,UAAU,CACvB,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,CACvB,UAAU,CAAE,IAAI,CAChB,KAAK,CAAE,GAAG,CACV,OAAO,CAAE,MAAM,CAAC,IAAI,AACtB,CAAC,AAED,iBAAiB,8BAAC,CAAC,AACjB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,CAAC,CACT,OAAO,CAAE,IAAI,CACb,WAAW,CAAE,QAAQ,CACrB,eAAe,CAAE,MAAM,AACzB,CAAC,AAED,gCAAiB,CAAG,eAAE,CAAC,AACrB,MAAM,CAAE,MAAM,AAChB,CAAC,AAED,QAAQ,8BAAC,CAAC,AACR,gBAAgB,CAAE,IAAI,wBAAwB,CAAC,AACjD,CAAC\"}"
};

const AllGroups = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let grouplist = [];
	let groupname = "";

	onMount(() => {
		getAllGroups();
	});

	async function getAllGroups() {
		const url = "http://localhost:8080/fetchgroups";

		fetch(url).then(response => response.json()).then(data => {
			const dataArr = data.map(grp => grp.groupname);
			grouplist = dataArr;
		}).catch(error => {
			console.log(error);
		});
	}

	$$result.css.add(css);
	!isEmpty(groupname);

	return `<main><div class="${"page-container svelte-19y6orm"}">${`<div class="${"createDiv svelte-19y6orm"}">${validate_component(Button, "Button").$$render($$result, {}, {}, {
			default: () => {
				return `Create Group`;
			}
		})}</div>`}

    <table class="${"svelte-19y6orm"}"><thead><tr class="${"svelte-19y6orm"}"><th class="${"svelte-19y6orm"}">S/N</th>
          <th class="${"svelte-19y6orm"}">Name</th></tr></thead>
      <tbody>${each(grouplist, (group, i) => {
		return `<tr class="${escape(null_to_empty(i % 2 === 0 && "alt-row"), true) + " svelte-19y6orm"}"><td class="${"svelte-19y6orm"}">${escape(i + 1)}</td>
            <td class="${"svelte-19y6orm"}">${escape(group)}</td>
          </tr>`;
	})}</tbody></table></div>
</main>`;
});

/* src\page\GroupManagement.svelte generated by Svelte v3.50.1 */

const GroupManagement = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<main>${validate_component(Navbar, "Navbar").$$render($$result, {}, {}, {})}
  ${validate_component(AllGroups, "AllGroups").$$render($$result, {}, {}, {})}</main>`;
});

/* src\page\NotFound.svelte generated by Svelte v3.50.1 */

const NotFound = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<main class="${"page-container"}"><h2>Page not found</h2>
    ${validate_component(Button, "Button").$$render($$result, {}, {}, {
		default: () => {
			return `Return Home`;
		}
	})}</main>`;
});

/* src\page\AppForm.svelte generated by Svelte v3.50.1 */

const AppForm_1 = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<main>${validate_component(Navbar, "Navbar").$$render($$result, {}, {}, {})}
  ${validate_component(AppForm, "AppForm").$$render($$result, {}, {}, {})}</main>`;
});

/* src\page\TaskForma.svelte generated by Svelte v3.50.1 */

const TaskForma = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<main>${validate_component(Navbar, "Navbar").$$render($$result, {}, {}, {})}
    ${validate_component(TaskForma$1, "TaskForm").$$render($$result, {}, {}, {})}</main>`;
});

/* src\App.svelte generated by Svelte v3.50.1 */

const App = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { url = "" } = $$props;
	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);

	return `${validate_component(Router, "Router").$$render($$result, { url }, {}, {
		default: () => {
			return `${validate_component(Route, "Route").$$render($$result, { path: "/", component: Homepage }, {}, {})}

  ${validate_component(ProtectedRoutes, "ProtectedRoutes").$$render($$result, { path: "/dashboard", component: Dashboard }, {}, {})}
  ${validate_component(ProtectedRoutes, "ProtectedRoutes").$$render($$result, { path: "/appForm", component: AppForm_1 }, {}, {})}
  ${validate_component(ProtectedRoutes, "ProtectedRoutes").$$render($$result, { path: "/taskForm", component: TaskForma }, {}, {})}
  ${validate_component(ProtectedRoutes, "ProtectedRoutes").$$render($$result, { path: "/profile", component: Profile }, {}, {})}
  ${validate_component(ProtectedRoutes, "ProtectedRoutes").$$render(
				$$result,
				{
					path: "/userManagement",
					component: UserManagement
				},
				{},
				{}
			)}
  ${validate_component(ProtectedRoutes, "ProtectedRoutes").$$render(
				$$result,
				{
					path: "/groupManagement",
					component: GroupManagement
				},
				{},
				{}
			)}
  ${validate_component(Route, "Route").$$render($$result, { component: NotFound }, {}, {})}`;
		}
	})}`;
});

module.exports = App;
