
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
(function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
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
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
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
    function component_subscribe(component, store, callback) {
        component.$$.on_destroy.push(subscribe(store, callback));
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot_base(slot, slot_definition, ctx, $$scope, slot_changes, get_slot_context_fn) {
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }
    function get_all_dirty_from_scope($$scope) {
        if ($$scope.ctx.length > 32) {
            const dirty = [];
            const length = $$scope.ctx.length / 32;
            for (let i = 0; i < length; i++) {
                dirty[i] = -1;
            }
            return dirty;
        }
        return -1;
    }
    function exclude_internal_props(props) {
        const result = {};
        for (const k in props)
            if (k[0] !== '$')
                result[k] = props[k];
        return result;
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }

    const is_client = typeof window !== 'undefined';
    let now = is_client
        ? () => window.performance.now()
        : () => Date.now();
    let raf = is_client ? cb => requestAnimationFrame(cb) : noop;

    const tasks = new Set();
    function run_tasks(now) {
        tasks.forEach(task => {
            if (!task.c(now)) {
                tasks.delete(task);
                task.f();
            }
        });
        if (tasks.size !== 0)
            raf(run_tasks);
    }
    /**
     * Creates a new task that runs on each raf frame
     * until it returns a falsy value or is aborted
     */
    function loop(callback) {
        let task;
        if (tasks.size === 0)
            raf(run_tasks);
        return {
            promise: new Promise(fulfill => {
                tasks.add(task = { c: callback, f: fulfill });
            }),
            abort() {
                tasks.delete(task);
            }
        };
    }

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating = false;
    function start_hydrating() {
        is_hydrating = true;
    }
    function end_hydrating() {
        is_hydrating = false;
    }
    function upper_bound(low, high, key, value) {
        // Return first index of value larger than input value in the range [low, high)
        while (low < high) {
            const mid = low + ((high - low) >> 1);
            if (key(mid) <= value) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        return low;
    }
    function init_hydrate(target) {
        if (target.hydrate_init)
            return;
        target.hydrate_init = true;
        // We know that all children have claim_order values since the unclaimed have been detached if target is not <head>
        let children = target.childNodes;
        // If target is <head>, there may be children without claim_order
        if (target.nodeName === 'HEAD') {
            const myChildren = [];
            for (let i = 0; i < children.length; i++) {
                const node = children[i];
                if (node.claim_order !== undefined) {
                    myChildren.push(node);
                }
            }
            children = myChildren;
        }
        /*
        * Reorder claimed children optimally.
        * We can reorder claimed children optimally by finding the longest subsequence of
        * nodes that are already claimed in order and only moving the rest. The longest
        * subsequence subsequence of nodes that are claimed in order can be found by
        * computing the longest increasing subsequence of .claim_order values.
        *
        * This algorithm is optimal in generating the least amount of reorder operations
        * possible.
        *
        * Proof:
        * We know that, given a set of reordering operations, the nodes that do not move
        * always form an increasing subsequence, since they do not move among each other
        * meaning that they must be already ordered among each other. Thus, the maximal
        * set of nodes that do not move form a longest increasing subsequence.
        */
        // Compute longest increasing subsequence
        // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
        const m = new Int32Array(children.length + 1);
        // Predecessor indices + 1
        const p = new Int32Array(children.length);
        m[0] = -1;
        let longest = 0;
        for (let i = 0; i < children.length; i++) {
            const current = children[i].claim_order;
            // Find the largest subsequence length such that it ends in a value less than our current value
            // upper_bound returns first greater value, so we subtract one
            // with fast path for when we are on the current longest subsequence
            const seqLen = ((longest > 0 && children[m[longest]].claim_order <= current) ? longest + 1 : upper_bound(1, longest, idx => children[m[idx]].claim_order, current)) - 1;
            p[i] = m[seqLen] + 1;
            const newLen = seqLen + 1;
            // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
            m[newLen] = i;
            longest = Math.max(newLen, longest);
        }
        // The longest increasing subsequence of nodes (initially reversed)
        const lis = [];
        // The rest of the nodes, nodes that will be moved
        const toMove = [];
        let last = children.length - 1;
        for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
            lis.push(children[cur - 1]);
            for (; last >= cur; last--) {
                toMove.push(children[last]);
            }
            last--;
        }
        for (; last >= 0; last--) {
            toMove.push(children[last]);
        }
        lis.reverse();
        // We sort the nodes being moved to guarantee that their insertion order matches the claim order
        toMove.sort((a, b) => a.claim_order - b.claim_order);
        // Finally, we move the nodes
        for (let i = 0, j = 0; i < toMove.length; i++) {
            while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
                j++;
            }
            const anchor = j < lis.length ? lis[j] : null;
            target.insertBefore(toMove[i], anchor);
        }
    }
    function append_hydration(target, node) {
        if (is_hydrating) {
            init_hydrate(target);
            if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentNode !== target))) {
                target.actual_end_child = target.firstChild;
            }
            // Skip nodes of undefined ordering
            while ((target.actual_end_child !== null) && (target.actual_end_child.claim_order === undefined)) {
                target.actual_end_child = target.actual_end_child.nextSibling;
            }
            if (node !== target.actual_end_child) {
                // We only insert if the ordering of this node should be modified or the parent node is not target
                if (node.claim_order !== undefined || node.parentNode !== target) {
                    target.insertBefore(node, target.actual_end_child);
                }
            }
            else {
                target.actual_end_child = node.nextSibling;
            }
        }
        else if (node.parentNode !== target || node.nextSibling !== null) {
            target.appendChild(node);
        }
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function insert_hydration(target, node, anchor) {
        if (is_hydrating && !anchor) {
            append_hydration(target, node);
        }
        else if (node.parentNode !== target || node.nextSibling != anchor) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function prevent_default(fn) {
        return function (event) {
            event.preventDefault();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function stop_propagation(fn) {
        return function (event) {
            event.stopPropagation();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function self(fn) {
        return function (event) {
            // @ts-ignore
            if (event.target === this)
                fn.call(this, event);
        };
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function set_svg_attributes(node, attributes) {
        for (const key in attributes) {
            attr(node, key, attributes[key]);
        }
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function init_claim_info(nodes) {
        if (nodes.claim_info === undefined) {
            nodes.claim_info = { last_index: 0, total_claimed: 0 };
        }
    }
    function claim_node(nodes, predicate, processNode, createNode, dontUpdateLastIndex = false) {
        // Try to find nodes in an order such that we lengthen the longest increasing subsequence
        init_claim_info(nodes);
        const resultNode = (() => {
            // We first try to find an element after the previous one
            for (let i = nodes.claim_info.last_index; i < nodes.length; i++) {
                const node = nodes[i];
                if (predicate(node)) {
                    const replacement = processNode(node);
                    if (replacement === undefined) {
                        nodes.splice(i, 1);
                    }
                    else {
                        nodes[i] = replacement;
                    }
                    if (!dontUpdateLastIndex) {
                        nodes.claim_info.last_index = i;
                    }
                    return node;
                }
            }
            // Otherwise, we try to find one before
            // We iterate in reverse so that we don't go too far back
            for (let i = nodes.claim_info.last_index - 1; i >= 0; i--) {
                const node = nodes[i];
                if (predicate(node)) {
                    const replacement = processNode(node);
                    if (replacement === undefined) {
                        nodes.splice(i, 1);
                    }
                    else {
                        nodes[i] = replacement;
                    }
                    if (!dontUpdateLastIndex) {
                        nodes.claim_info.last_index = i;
                    }
                    else if (replacement === undefined) {
                        // Since we spliced before the last_index, we decrease it
                        nodes.claim_info.last_index--;
                    }
                    return node;
                }
            }
            // If we can't find any matching node, we create a new one
            return createNode();
        })();
        resultNode.claim_order = nodes.claim_info.total_claimed;
        nodes.claim_info.total_claimed += 1;
        return resultNode;
    }
    function claim_element_base(nodes, name, attributes, create_element) {
        return claim_node(nodes, (node) => node.nodeName === name, (node) => {
            const remove = [];
            for (let j = 0; j < node.attributes.length; j++) {
                const attribute = node.attributes[j];
                if (!attributes[attribute.name]) {
                    remove.push(attribute.name);
                }
            }
            remove.forEach(v => node.removeAttribute(v));
            return undefined;
        }, () => create_element(name));
    }
    function claim_element(nodes, name, attributes) {
        return claim_element_base(nodes, name, attributes, element);
    }
    function claim_svg_element(nodes, name, attributes) {
        return claim_element_base(nodes, name, attributes, svg_element);
    }
    function claim_text(nodes, data) {
        return claim_node(nodes, (node) => node.nodeType === 3, (node) => {
            const dataStr = '' + data;
            if (node.data.startsWith(dataStr)) {
                if (node.data.length !== dataStr.length) {
                    return node.splitText(dataStr.length);
                }
            }
            else {
                node.data = dataStr;
            }
        }, () => text(data), true // Text nodes should not update last index since it is likely not worth it to eliminate an increasing subsequence of actual elements
        );
    }
    function claim_space(nodes) {
        return claim_text(nodes, ' ');
    }
    function find_comment(nodes, text, start) {
        for (let i = start; i < nodes.length; i += 1) {
            const node = nodes[i];
            if (node.nodeType === 8 /* comment node */ && node.textContent.trim() === text) {
                return i;
            }
        }
        return nodes.length;
    }
    function claim_html_tag(nodes, is_svg) {
        // find html opening tag
        const start_index = find_comment(nodes, 'HTML_TAG_START', 0);
        const end_index = find_comment(nodes, 'HTML_TAG_END', start_index);
        if (start_index === end_index) {
            return new HtmlTagHydration(undefined, is_svg);
        }
        init_claim_info(nodes);
        const html_tag_nodes = nodes.splice(start_index, end_index - start_index + 1);
        detach(html_tag_nodes[0]);
        detach(html_tag_nodes[html_tag_nodes.length - 1]);
        const claimed_nodes = html_tag_nodes.slice(1, html_tag_nodes.length - 1);
        for (const n of claimed_nodes) {
            n.claim_order = nodes.claim_info.total_claimed;
            nodes.claim_info.total_claimed += 1;
        }
        return new HtmlTagHydration(claimed_nodes, is_svg);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function set_style(node, key, value, important) {
        if (value === null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function select_option(select, value) {
        for (let i = 0; i < select.options.length; i += 1) {
            const option = select.options[i];
            if (option.__value === value) {
                option.selected = true;
                return;
            }
        }
        select.selectedIndex = -1; // no option should be selected
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }
    class HtmlTag {
        constructor(is_svg = false) {
            this.is_svg = false;
            this.is_svg = is_svg;
            this.e = this.n = null;
        }
        c(html) {
            this.h(html);
        }
        m(html, target, anchor = null) {
            if (!this.e) {
                if (this.is_svg)
                    this.e = svg_element(target.nodeName);
                else
                    this.e = element(target.nodeName);
                this.t = target;
                this.c(html);
            }
            this.i(anchor);
        }
        h(html) {
            this.e.innerHTML = html;
            this.n = Array.from(this.e.childNodes);
        }
        i(anchor) {
            for (let i = 0; i < this.n.length; i += 1) {
                insert(this.t, this.n[i], anchor);
            }
        }
        p(html) {
            this.d();
            this.h(html);
            this.i(this.a);
        }
        d() {
            this.n.forEach(detach);
        }
    }
    class HtmlTagHydration extends HtmlTag {
        constructor(claimed_nodes, is_svg = false) {
            super(is_svg);
            this.e = this.n = null;
            this.l = claimed_nodes;
        }
        c(html) {
            if (this.l) {
                this.n = this.l;
            }
            else {
                super.c(html);
            }
        }
        i(anchor) {
            for (let i = 0; i < this.n.length; i += 1) {
                insert_hydration(this.t, this.n[i], anchor);
            }
        }
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
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            // @ts-ignore
            callbacks.slice().forEach(fn => fn.call(this, event));
        }
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }

    function destroy_block(block, lookup) {
        block.d(1);
        lookup.delete(block.key);
    }
    function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
        let o = old_blocks.length;
        let n = list.length;
        let i = o;
        const old_indexes = {};
        while (i--)
            old_indexes[old_blocks[i].key] = i;
        const new_blocks = [];
        const new_lookup = new Map();
        const deltas = new Map();
        i = n;
        while (i--) {
            const child_ctx = get_context(ctx, list, i);
            const key = get_key(child_ctx);
            let block = lookup.get(key);
            if (!block) {
                block = create_each_block(key, child_ctx);
                block.c();
            }
            else if (dynamic) {
                block.p(child_ctx, dirty);
            }
            new_lookup.set(key, new_blocks[i] = block);
            if (key in old_indexes)
                deltas.set(key, Math.abs(i - old_indexes[key]));
        }
        const will_move = new Set();
        const did_move = new Set();
        function insert(block) {
            transition_in(block, 1);
            block.m(node, next);
            lookup.set(block.key, block);
            next = block.first;
            n--;
        }
        while (o && n) {
            const new_block = new_blocks[n - 1];
            const old_block = old_blocks[o - 1];
            const new_key = new_block.key;
            const old_key = old_block.key;
            if (new_block === old_block) {
                // do nothing
                next = new_block.first;
                o--;
                n--;
            }
            else if (!new_lookup.has(old_key)) {
                // remove old block
                destroy(old_block, lookup);
                o--;
            }
            else if (!lookup.has(new_key) || will_move.has(new_key)) {
                insert(new_block);
            }
            else if (did_move.has(old_key)) {
                o--;
            }
            else if (deltas.get(new_key) > deltas.get(old_key)) {
                did_move.add(new_key);
                insert(new_block);
            }
            else {
                will_move.add(old_key);
                o--;
            }
        }
        while (o--) {
            const old_block = old_blocks[o];
            if (!new_lookup.has(old_block.key))
                destroy(old_block, lookup);
        }
        while (n)
            insert(new_blocks[n - 1]);
        return new_blocks;
    }

    function get_spread_update(levels, updates) {
        const update = {};
        const to_null_out = {};
        const accounted_for = { $$scope: 1 };
        let i = levels.length;
        while (i--) {
            const o = levels[i];
            const n = updates[i];
            if (n) {
                for (const key in o) {
                    if (!(key in n))
                        to_null_out[key] = 1;
                }
                for (const key in n) {
                    if (!accounted_for[key]) {
                        update[key] = n[key];
                        accounted_for[key] = 1;
                    }
                }
                levels[i] = n;
            }
            else {
                for (const key in o) {
                    accounted_for[key] = 1;
                }
            }
        }
        for (const key in to_null_out) {
            if (!(key in update))
                update[key] = undefined;
        }
        return update;
    }
    function get_spread_object(spread_props) {
        return typeof spread_props === 'object' && spread_props !== null ? spread_props : {};
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function claim_component(block, parent_nodes) {
        block && block.l(parent_nodes);
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating();
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            end_hydrating();
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
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

    function create_fragment$y(ctx) {
    	let current;
    	const default_slot_template = /*#slots*/ ctx[9].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[8], null);

    	return {
    		c() {
    			if (default_slot) default_slot.c();
    		},
    		l(nodes) {
    			if (default_slot) default_slot.l(nodes);
    		},
    		m(target, anchor) {
    			if (default_slot) {
    				default_slot.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 256)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[8],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[8])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[8], dirty, null),
    						null
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    function instance$r($$self, $$props, $$invalidate) {
    	let $location;
    	let $routes;
    	let $base;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { basepath = "/" } = $$props;
    	let { url = null } = $$props;
    	const locationContext = getContext(LOCATION);
    	const routerContext = getContext(ROUTER);
    	const routes = writable([]);
    	component_subscribe($$self, routes, value => $$invalidate(6, $routes = value));
    	const activeRoute = writable(null);
    	let hasActiveRoute = false; // Used in SSR to synchronously set that a Route is active.

    	// If locationContext is not set, this is the topmost Router in the tree.
    	// If the `url` prop is given we force the location to it.
    	const location = locationContext || writable(url ? { pathname: url } : globalHistory.location);

    	component_subscribe($$self, location, value => $$invalidate(5, $location = value));

    	// If routerContext is set, the routerBase of the parent Router
    	// will be the base for this Router's descendants.
    	// If routerContext is not set, the path and resolved uri will both
    	// have the value of the basepath prop.
    	const base = routerContext
    	? routerContext.routerBase
    	: writable({ path: basepath, uri: basepath });

    	component_subscribe($$self, base, value => $$invalidate(7, $base = value));

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

    	$$self.$$set = $$props => {
    		if ('basepath' in $$props) $$invalidate(3, basepath = $$props.basepath);
    		if ('url' in $$props) $$invalidate(4, url = $$props.url);
    		if ('$$scope' in $$props) $$invalidate(8, $$scope = $$props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*$base*/ 128) {
    			// This reactive statement will update all the Routes' path when
    			// the basepath changes.
    			{
    				const { path: basepath } = $base;

    				routes.update(rs => {
    					rs.forEach(r => r.path = combinePaths(basepath, r._path));
    					return rs;
    				});
    			}
    		}

    		if ($$self.$$.dirty & /*$routes, $location*/ 96) {
    			// This reactive statement will be run when the Router is created
    			// when there are no Routes and then again the following tick, so it
    			// will not find an active Route in SSR and in the browser it will only
    			// pick an active Route after all Routes have been registered.
    			{
    				const bestMatch = pick($routes, $location.pathname);
    				activeRoute.set(bestMatch);
    			}
    		}
    	};

    	return [
    		routes,
    		location,
    		base,
    		basepath,
    		url,
    		$location,
    		$routes,
    		$base,
    		$$scope,
    		slots
    	];
    }

    class Router extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$r, create_fragment$y, safe_not_equal, { basepath: 3, url: 4 });
    	}
    }

    /* node_modules\svelte-routing\src\Route.svelte generated by Svelte v3.50.1 */

    const get_default_slot_changes = dirty => ({
    	params: dirty & /*routeParams*/ 4,
    	location: dirty & /*$location*/ 16
    });

    const get_default_slot_context = ctx => ({
    	params: /*routeParams*/ ctx[2],
    	location: /*$location*/ ctx[4]
    });

    // (40:0) {#if $activeRoute !== null && $activeRoute.route === route}
    function create_if_block$9(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block_1$7, create_else_block$4];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*component*/ ctx[0] !== null) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (43:2) {:else}
    function create_else_block$4(ctx) {
    	let current;
    	const default_slot_template = /*#slots*/ ctx[10].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], get_default_slot_context);

    	return {
    		c() {
    			if (default_slot) default_slot.c();
    		},
    		l(nodes) {
    			if (default_slot) default_slot.l(nodes);
    		},
    		m(target, anchor) {
    			if (default_slot) {
    				default_slot.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope, routeParams, $location*/ 532)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[9],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[9])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, get_default_slot_changes),
    						get_default_slot_context
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    // (41:2) {#if component !== null}
    function create_if_block_1$7(ctx) {
    	let switch_instance;
    	let switch_instance_anchor;
    	let current;

    	const switch_instance_spread_levels = [
    		{ location: /*$location*/ ctx[4] },
    		/*routeParams*/ ctx[2],
    		/*routeProps*/ ctx[3]
    	];

    	var switch_value = /*component*/ ctx[0];

    	function switch_props(ctx) {
    		let switch_instance_props = {};

    		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
    			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
    		}

    		return { props: switch_instance_props };
    	}

    	if (switch_value) {
    		switch_instance = new switch_value(switch_props());
    	}

    	return {
    		c() {
    			if (switch_instance) create_component(switch_instance.$$.fragment);
    			switch_instance_anchor = empty();
    		},
    		l(nodes) {
    			if (switch_instance) claim_component(switch_instance.$$.fragment, nodes);
    			switch_instance_anchor = empty();
    		},
    		m(target, anchor) {
    			if (switch_instance) {
    				mount_component(switch_instance, target, anchor);
    			}

    			insert_hydration(target, switch_instance_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const switch_instance_changes = (dirty & /*$location, routeParams, routeProps*/ 28)
    			? get_spread_update(switch_instance_spread_levels, [
    					dirty & /*$location*/ 16 && { location: /*$location*/ ctx[4] },
    					dirty & /*routeParams*/ 4 && get_spread_object(/*routeParams*/ ctx[2]),
    					dirty & /*routeProps*/ 8 && get_spread_object(/*routeProps*/ ctx[3])
    				])
    			: {};

    			if (switch_value !== (switch_value = /*component*/ ctx[0])) {
    				if (switch_instance) {
    					group_outros();
    					const old_component = switch_instance;

    					transition_out(old_component.$$.fragment, 1, 0, () => {
    						destroy_component(old_component, 1);
    					});

    					check_outros();
    				}

    				if (switch_value) {
    					switch_instance = new switch_value(switch_props());
    					create_component(switch_instance.$$.fragment);
    					transition_in(switch_instance.$$.fragment, 1);
    					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
    				} else {
    					switch_instance = null;
    				}
    			} else if (switch_value) {
    				switch_instance.$set(switch_instance_changes);
    			}
    		},
    		i(local) {
    			if (current) return;
    			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(switch_instance_anchor);
    			if (switch_instance) destroy_component(switch_instance, detaching);
    		}
    	};
    }

    function create_fragment$x(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*$activeRoute*/ ctx[1] !== null && /*$activeRoute*/ ctx[1].route === /*route*/ ctx[7] && create_if_block$9(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (/*$activeRoute*/ ctx[1] !== null && /*$activeRoute*/ ctx[1].route === /*route*/ ctx[7]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*$activeRoute*/ 2) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block$9(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$q($$self, $$props, $$invalidate) {
    	let $activeRoute;
    	let $location;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { path = "" } = $$props;
    	let { component = null } = $$props;
    	const { registerRoute, unregisterRoute, activeRoute } = getContext(ROUTER);
    	component_subscribe($$self, activeRoute, value => $$invalidate(1, $activeRoute = value));
    	const location = getContext(LOCATION);
    	component_subscribe($$self, location, value => $$invalidate(4, $location = value));

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

    	$$self.$$set = $$new_props => {
    		$$invalidate(13, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ('path' in $$new_props) $$invalidate(8, path = $$new_props.path);
    		if ('component' in $$new_props) $$invalidate(0, component = $$new_props.component);
    		if ('$$scope' in $$new_props) $$invalidate(9, $$scope = $$new_props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*$activeRoute*/ 2) {
    			if ($activeRoute && $activeRoute.route === route) {
    				$$invalidate(2, routeParams = $activeRoute.params);
    			}
    		}

    		{
    			const { path, component, ...rest } = $$props;
    			$$invalidate(3, routeProps = rest);
    		}
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		component,
    		$activeRoute,
    		routeParams,
    		routeProps,
    		$location,
    		activeRoute,
    		location,
    		route,
    		path,
    		$$scope,
    		slots
    	];
    }

    class Route extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$q, create_fragment$x, safe_not_equal, { path: 8, component: 0 });
    	}
    }

    /* src\components\HomepageContent.svelte generated by Svelte v3.50.1 */

    function create_fragment$w(ctx) {
    	let main;
    	let div4;
    	let div3;
    	let div0;
    	let span0;
    	let t0;
    	let t1;
    	let input0;
    	let t2;
    	let div1;
    	let span1;
    	let t3;
    	let t4;
    	let input1;
    	let t5;
    	let div2;
    	let button;
    	let t6;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			main = element("main");
    			div4 = element("div");
    			div3 = element("div");
    			div0 = element("div");
    			span0 = element("span");
    			t0 = text("Username:");
    			t1 = space();
    			input0 = element("input");
    			t2 = space();
    			div1 = element("div");
    			span1 = element("span");
    			t3 = text("Password:");
    			t4 = space();
    			input1 = element("input");
    			t5 = space();
    			div2 = element("div");
    			button = element("button");
    			t6 = text("Login");
    			this.h();
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", { class: true });
    			var main_nodes = children(main);
    			div4 = claim_element(main_nodes, "DIV", { class: true });
    			var div4_nodes = children(div4);
    			div3 = claim_element(div4_nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);
    			div0 = claim_element(div3_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			span0 = claim_element(div0_nodes, "SPAN", { class: true });
    			var span0_nodes = children(span0);
    			t0 = claim_text(span0_nodes, "Username:");
    			span0_nodes.forEach(detach);
    			t1 = claim_space(div0_nodes);

    			input0 = claim_element(div0_nodes, "INPUT", {
    				class: true,
    				type: true,
    				name: true,
    				id: true
    			});

    			div0_nodes.forEach(detach);
    			t2 = claim_space(div3_nodes);
    			div1 = claim_element(div3_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			span1 = claim_element(div1_nodes, "SPAN", { class: true });
    			var span1_nodes = children(span1);
    			t3 = claim_text(span1_nodes, "Password:");
    			span1_nodes.forEach(detach);
    			t4 = claim_space(div1_nodes);

    			input1 = claim_element(div1_nodes, "INPUT", {
    				class: true,
    				type: true,
    				name: true,
    				id: true
    			});

    			div1_nodes.forEach(detach);
    			t5 = claim_space(div3_nodes);
    			div2 = claim_element(div3_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			button = claim_element(div2_nodes, "BUTTON", { class: true, id: true });
    			var button_nodes = children(button);
    			t6 = claim_text(button_nodes, "Login");
    			button_nodes.forEach(detach);
    			div2_nodes.forEach(detach);
    			div3_nodes.forEach(detach);
    			div4_nodes.forEach(detach);
    			main_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(span0, "class", "iHeader svelte-akqwwi");
    			attr(input0, "class", "iField svelte-akqwwi");
    			attr(input0, "type", "text");
    			attr(input0, "name", "username");
    			attr(input0, "id", "username");
    			attr(div0, "class", "iContain svelte-akqwwi");
    			attr(span1, "class", "iHeader svelte-akqwwi");
    			attr(input1, "class", "iField svelte-akqwwi");
    			attr(input1, "type", "password");
    			attr(input1, "name", "password");
    			attr(input1, "id", "password");
    			attr(div1, "class", "iContain svelte-akqwwi");
    			attr(button, "class", "loginButton svelte-akqwwi");
    			attr(button, "id", "login");
    			attr(div2, "class", "buttonContain svelte-akqwwi");
    			attr(div3, "class", "container svelte-akqwwi");
    			attr(div4, "class", "homepage svelte-akqwwi");
    			attr(main, "class", "svelte-akqwwi");
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			append_hydration(main, div4);
    			append_hydration(div4, div3);
    			append_hydration(div3, div0);
    			append_hydration(div0, span0);
    			append_hydration(span0, t0);
    			append_hydration(div0, t1);
    			append_hydration(div0, input0);
    			append_hydration(div3, t2);
    			append_hydration(div3, div1);
    			append_hydration(div1, span1);
    			append_hydration(span1, t3);
    			append_hydration(div1, t4);
    			append_hydration(div1, input1);
    			append_hydration(div3, t5);
    			append_hydration(div3, div2);
    			append_hydration(div2, button);
    			append_hydration(button, t6);

    			if (!mounted) {
    				dispose = [
    					listen(input0, "change", /*handleUserOnChange*/ ctx[0]),
    					listen(input1, "change", /*handlePassOnChange*/ ctx[1]),
    					listen(button, "click", /*onLogin*/ ctx[2])
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(main);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$p($$self) {
    	let username;
    	let password;

    	const handleUserOnChange = e => {
    		username = e.target.value;
    	};

    	const handlePassOnChange = e => {
    		password = e.target.value;
    	};

    	const onLogin = () => {
    		const url = "http://localhost:8080/authenticate";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({ username, password })
    		}).then(response => response.json()).then(data => {
    			if (data.Code != 403) {
    				sessionStorage.setItem("JWT", data.Message);
    				window.location.replace("/dashboard");
    			} else {
    				alert(data.Message);
    			}
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	return [handleUserOnChange, handlePassOnChange, onLogin];
    }

    class HomepageContent extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$p, create_fragment$w, safe_not_equal, {});
    	}
    }

    /* src\page\Homepage.svelte generated by Svelte v3.50.1 */

    function create_fragment$v(ctx) {
    	let main;
    	let homepagecontent;
    	let current;
    	homepagecontent = new HomepageContent({});

    	return {
    		c() {
    			main = element("main");
    			create_component(homepagecontent.$$.fragment);
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			claim_component(homepagecontent.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			mount_component(homepagecontent, main, null);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(homepagecontent.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(homepagecontent.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(homepagecontent);
    		}
    	};
    }

    class Homepage extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$v, safe_not_equal, {});
    	}
    }

    /* src\utils\ProtectedRoutes.svelte generated by Svelte v3.50.1 */

    function create_if_block_1$6(ctx) {
    	let route;
    	let current;
    	route = new Route({ props: { component: Homepage } });

    	return {
    		c() {
    			create_component(route.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(route.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(route, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(route.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(route.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(route, detaching);
    		}
    	};
    }

    // (45:0) {#if isLoggedIn && loaded}
    function create_if_block$8(ctx) {
    	let route;
    	let current;

    	route = new Route({
    			props: {
    				path: /*path*/ ctx[0],
    				component: /*component*/ ctx[1]
    			}
    		});

    	return {
    		c() {
    			create_component(route.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(route.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(route, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const route_changes = {};
    			if (dirty & /*path*/ 1) route_changes.path = /*path*/ ctx[0];
    			if (dirty & /*component*/ 2) route_changes.component = /*component*/ ctx[1];
    			route.$set(route_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(route.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(route.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(route, detaching);
    		}
    	};
    }

    function create_fragment$u(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block$8, create_if_block_1$6];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*isLoggedIn*/ ctx[2] && /*loaded*/ ctx[3]) return 0;
    		if (!/*isLoggedIn*/ ctx[2] && /*loaded*/ ctx[3]) return 1;
    		return -1;
    	}

    	if (~(current_block_type_index = select_block_type(ctx))) {
    		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	}

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].m(target, anchor);
    			}

    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if (~current_block_type_index) {
    					if_blocks[current_block_type_index].p(ctx, dirty);
    				}
    			} else {
    				if (if_block) {
    					group_outros();

    					transition_out(if_blocks[previous_block_index], 1, 1, () => {
    						if_blocks[previous_block_index] = null;
    					});

    					check_outros();
    				}

    				if (~current_block_type_index) {
    					if_block = if_blocks[current_block_type_index];

    					if (!if_block) {
    						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    						if_block.c();
    					} else {
    						if_block.p(ctx, dirty);
    					}

    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				} else {
    					if_block = null;
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].d(detaching);
    			}

    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$o($$self, $$props, $$invalidate) {
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
    					$$invalidate(2, isLoggedIn = true);
    					$$invalidate(3, loaded = true);
    				} else {
    					$$invalidate(2, isLoggedIn = false);
    					$$invalidate(3, loaded = true);
    					navigate("/");
    				}
    			}).catch(error => {
    				console.log(error);
    				$$invalidate(2, isLoggedIn = false);
    				$$invalidate(3, loaded = true);
    				navigate("/");
    			});
    		} else {
    			$$invalidate(3, loaded = true);
    			navigate("/");
    		}
    	});

    	$$self.$$set = $$props => {
    		if ('path' in $$props) $$invalidate(0, path = $$props.path);
    		if ('component' in $$props) $$invalidate(1, component = $$props.component);
    	};

    	return [path, component, isLoggedIn, loaded];
    }

    class ProtectedRoutes extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$o, create_fragment$u, safe_not_equal, { path: 0, component: 1 });
    	}
    }

    /* src\components\Navbar.svelte generated by Svelte v3.50.1 */

    function create_if_block$7(ctx) {
    	let div1;
    	let button;
    	let t0;
    	let i;
    	let t1;
    	let div0;
    	let a0;
    	let t2;
    	let t3;
    	let a1;
    	let t4;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div1 = element("div");
    			button = element("button");
    			t0 = text("Admin\r\n      ");
    			i = element("i");
    			t1 = space();
    			div0 = element("div");
    			a0 = element("a");
    			t2 = text("User Management");
    			t3 = space();
    			a1 = element("a");
    			t4 = text("Group Management");
    			this.h();
    		},
    		l(nodes) {
    			div1 = claim_element(nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			button = claim_element(div1_nodes, "BUTTON", { class: true });
    			var button_nodes = children(button);
    			t0 = claim_text(button_nodes, "Admin\r\n      ");
    			i = claim_element(button_nodes, "I", { class: true });
    			children(i).forEach(detach);
    			button_nodes.forEach(detach);
    			t1 = claim_space(div1_nodes);
    			div0 = claim_element(div1_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			a0 = claim_element(div0_nodes, "A", { href: true, class: true });
    			var a0_nodes = children(a0);
    			t2 = claim_text(a0_nodes, "User Management");
    			a0_nodes.forEach(detach);
    			t3 = claim_space(div0_nodes);
    			a1 = claim_element(div0_nodes, "A", { href: true, class: true });
    			var a1_nodes = children(a1);
    			t4 = claim_text(a1_nodes, "Group Management");
    			a1_nodes.forEach(detach);
    			div0_nodes.forEach(detach);
    			div1_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(i, "class", "fa fa-caret-down");
    			attr(button, "class", "dropbtn svelte-q9ubpp");
    			attr(a0, "href", null);
    			attr(a0, "class", "dropItem svelte-q9ubpp");
    			attr(a1, "href", null);
    			attr(a1, "class", "dropItem svelte-q9ubpp");
    			attr(div0, "class", "dropdown-content svelte-q9ubpp");
    			attr(div1, "class", "dropdown svelte-q9ubpp");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div1, anchor);
    			append_hydration(div1, button);
    			append_hydration(button, t0);
    			append_hydration(button, i);
    			append_hydration(div1, t1);
    			append_hydration(div1, div0);
    			append_hydration(div0, a0);
    			append_hydration(a0, t2);
    			append_hydration(div0, t3);
    			append_hydration(div0, a1);
    			append_hydration(a1, t4);

    			if (!mounted) {
    				dispose = [
    					listen(a0, "click", /*click_handler_2*/ ctx[4]),
    					listen(a1, "click", /*click_handler_3*/ ctx[5])
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$t(ctx) {
    	let nav;
    	let a0;
    	let t0;
    	let t1;
    	let a1;
    	let t2;
    	let t3;
    	let t4;
    	let div;
    	let a2;
    	let t5;
    	let mounted;
    	let dispose;
    	let if_block = /*isAdmin*/ ctx[0] === "true" && create_if_block$7(ctx);

    	return {
    		c() {
    			nav = element("nav");
    			a0 = element("a");
    			t0 = text("Dashboard");
    			t1 = space();
    			a1 = element("a");
    			t2 = text("Profile");
    			t3 = space();
    			if (if_block) if_block.c();
    			t4 = space();
    			div = element("div");
    			a2 = element("a");
    			t5 = text("Logout");
    			this.h();
    		},
    		l(nodes) {
    			nav = claim_element(nodes, "NAV", { class: true });
    			var nav_nodes = children(nav);
    			a0 = claim_element(nav_nodes, "A", { href: true, class: true });
    			var a0_nodes = children(a0);
    			t0 = claim_text(a0_nodes, "Dashboard");
    			a0_nodes.forEach(detach);
    			t1 = claim_space(nav_nodes);
    			a1 = claim_element(nav_nodes, "A", { href: true, class: true });
    			var a1_nodes = children(a1);
    			t2 = claim_text(a1_nodes, "Profile");
    			a1_nodes.forEach(detach);
    			t3 = claim_space(nav_nodes);
    			if (if_block) if_block.l(nav_nodes);
    			t4 = claim_space(nav_nodes);
    			div = claim_element(nav_nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			a2 = claim_element(div_nodes, "A", { href: true, class: true });
    			var a2_nodes = children(a2);
    			t5 = claim_text(a2_nodes, "Logout");
    			a2_nodes.forEach(detach);
    			div_nodes.forEach(detach);
    			nav_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(a0, "href", null);
    			attr(a0, "class", "svelte-q9ubpp");
    			attr(a1, "href", null);
    			attr(a1, "class", "svelte-q9ubpp");
    			attr(a2, "href", null);
    			attr(a2, "class", "svelte-q9ubpp");
    			attr(div, "class", "topnav-right svelte-q9ubpp");
    			attr(nav, "class", "navbar svelte-q9ubpp");
    		},
    		m(target, anchor) {
    			insert_hydration(target, nav, anchor);
    			append_hydration(nav, a0);
    			append_hydration(a0, t0);
    			append_hydration(nav, t1);
    			append_hydration(nav, a1);
    			append_hydration(a1, t2);
    			append_hydration(nav, t3);
    			if (if_block) if_block.m(nav, null);
    			append_hydration(nav, t4);
    			append_hydration(nav, div);
    			append_hydration(div, a2);
    			append_hydration(a2, t5);

    			if (!mounted) {
    				dispose = [
    					listen(a0, "click", /*click_handler*/ ctx[2]),
    					listen(a1, "click", /*click_handler_1*/ ctx[3]),
    					listen(a2, "click", /*logout*/ ctx[1])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (/*isAdmin*/ ctx[0] === "true") {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$7(ctx);
    					if_block.c();
    					if_block.m(nav, t4);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(nav);
    			if (if_block) if_block.d();
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$n($$self, $$props, $$invalidate) {
    	function logout() {
    		sessionStorage.clear();
    		navigate("/");
    	}

    	let isAdmin = "false";

    	onMount(() => {
    		let token = sessionStorage.getItem("JWT");

    		if (token != undefined || token != null) {
    			const url = "http://localhost:8080/authorize";

    			fetch(url, {
    				method: "POST",
    				body: JSON.stringify({ token, group: "admin" })
    			}).then(response => response.json()).then(data => {
    				$$invalidate(0, isAdmin = data.Message);
    			}).catch(error => {
    				console.log(error);
    			});
    		} else {
    			$$invalidate(0, isAdmin = "false");
    		}
    	});

    	const click_handler = () => {
    		navigate('/dashboard');
    	};

    	const click_handler_1 = () => {
    		navigate('/profile');
    	};

    	const click_handler_2 = () => {
    		navigate('/userManagement');
    	};

    	const click_handler_3 = () => {
    		navigate('/groupManagement');
    	};

    	return [
    		isAdmin,
    		logout,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3
    	];
    }

    class Navbar extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$n, create_fragment$t, safe_not_equal, {});
    	}
    }

    /* src\UI\Button.svelte generated by Svelte v3.50.1 */

    function create_fragment$s(ctx) {
    	let button;
    	let button_class_value;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[6].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[5], null);

    	return {
    		c() {
    			button = element("button");
    			if (default_slot) default_slot.c();
    			this.h();
    		},
    		l(nodes) {
    			button = claim_element(nodes, "BUTTON", { id: true, class: true, type: true });
    			var button_nodes = children(button);
    			if (default_slot) default_slot.l(button_nodes);
    			button_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(button, "id", /*id*/ ctx[4]);
    			attr(button, "class", button_class_value = "" + (null_to_empty(`${/*mode*/ ctx[0]} ${/*size*/ ctx[1]}`) + " svelte-1qf77kj"));
    			attr(button, "type", /*type*/ ctx[3]);
    			button.disabled = /*disabled*/ ctx[2];
    		},
    		m(target, anchor) {
    			insert_hydration(target, button, anchor);

    			if (default_slot) {
    				default_slot.m(button, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(button, "click", /*click_handler*/ ctx[7]),
    					listen(button, "submit", /*submit_handler*/ ctx[8])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 32)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[5],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[5])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[5], dirty, null),
    						null
    					);
    				}
    			}

    			if (!current || dirty & /*id*/ 16) {
    				attr(button, "id", /*id*/ ctx[4]);
    			}

    			if (!current || dirty & /*mode, size*/ 3 && button_class_value !== (button_class_value = "" + (null_to_empty(`${/*mode*/ ctx[0]} ${/*size*/ ctx[1]}`) + " svelte-1qf77kj"))) {
    				attr(button, "class", button_class_value);
    			}

    			if (!current || dirty & /*type*/ 8) {
    				attr(button, "type", /*type*/ ctx[3]);
    			}

    			if (!current || dirty & /*disabled*/ 4) {
    				button.disabled = /*disabled*/ ctx[2];
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$m($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { mode } = $$props;
    	let { size } = $$props;
    	let { disabled = false } = $$props;
    	let { type = "button" } = $$props;
    	let { id } = $$props;

    	function click_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function submit_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('mode' in $$props) $$invalidate(0, mode = $$props.mode);
    		if ('size' in $$props) $$invalidate(1, size = $$props.size);
    		if ('disabled' in $$props) $$invalidate(2, disabled = $$props.disabled);
    		if ('type' in $$props) $$invalidate(3, type = $$props.type);
    		if ('id' in $$props) $$invalidate(4, id = $$props.id);
    		if ('$$scope' in $$props) $$invalidate(5, $$scope = $$props.$$scope);
    	};

    	return [mode, size, disabled, type, id, $$scope, slots, click_handler, submit_handler];
    }

    class Button extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$m, create_fragment$s, safe_not_equal, {
    			mode: 0,
    			size: 1,
    			disabled: 2,
    			type: 3,
    			id: 4
    		});
    	}
    }

    /* src\UI\Modal.svelte generated by Svelte v3.50.1 */

    function create_fragment$r(ctx) {
    	let div0;
    	let t0;
    	let div3;
    	let div1;
    	let h3;
    	let t1;
    	let t2;
    	let p;
    	let t3;
    	let t4;
    	let div2;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*#slots*/ ctx[3].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[2], null);

    	return {
    		c() {
    			div0 = element("div");
    			t0 = space();
    			div3 = element("div");
    			div1 = element("div");
    			h3 = element("h3");
    			t1 = text(/*title*/ ctx[0]);
    			t2 = space();
    			p = element("p");
    			t3 = text("X");
    			t4 = space();
    			div2 = element("div");
    			if (default_slot) default_slot.c();
    			this.h();
    		},
    		l(nodes) {
    			div0 = claim_element(nodes, "DIV", { class: true });
    			children(div0).forEach(detach);
    			t0 = claim_space(nodes);
    			div3 = claim_element(nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);
    			div1 = claim_element(div3_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			h3 = claim_element(div1_nodes, "H3", { class: true });
    			var h3_nodes = children(h3);
    			t1 = claim_text(h3_nodes, /*title*/ ctx[0]);
    			h3_nodes.forEach(detach);
    			t2 = claim_space(div1_nodes);
    			p = claim_element(div1_nodes, "P", { class: true, style: true });
    			var p_nodes = children(p);
    			t3 = claim_text(p_nodes, "X");
    			p_nodes.forEach(detach);
    			div1_nodes.forEach(detach);
    			t4 = claim_space(div3_nodes);
    			div2 = claim_element(div3_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			if (default_slot) default_slot.l(div2_nodes);
    			div2_nodes.forEach(detach);
    			div3_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div0, "class", "modal-backdrop svelte-12aup7c");
    			attr(h3, "class", "svelte-12aup7c");
    			attr(p, "class", "close-btn svelte-12aup7c");
    			set_style(p, "font-family", "sans-serif");
    			attr(div1, "class", "modal-title svelte-12aup7c");
    			attr(div2, "class", "content svelte-12aup7c");
    			attr(div3, "class", "modal svelte-12aup7c");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div0, anchor);
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, div3, anchor);
    			append_hydration(div3, div1);
    			append_hydration(div1, h3);
    			append_hydration(h3, t1);
    			append_hydration(div1, t2);
    			append_hydration(div1, p);
    			append_hydration(p, t3);
    			append_hydration(div3, t4);
    			append_hydration(div3, div2);

    			if (default_slot) {
    				default_slot.m(div2, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = listen(p, "click", /*closeModal*/ ctx[1]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*title*/ 1) set_data(t1, /*title*/ ctx[0]);

    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 4)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[2],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[2])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[2], dirty, null),
    						null
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div0);
    			if (detaching) detach(t0);
    			if (detaching) detach(div3);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$l($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { title } = $$props;
    	const dispatch = createEventDispatcher();

    	function closeModal() {
    		dispatch("close");
    	}

    	window.onkeydown = e => {
    		if (e.key === "Escape") dispatch("close");
    	};

    	$$self.$$set = $$props => {
    		if ('title' in $$props) $$invalidate(0, title = $$props.title);
    		if ('$$scope' in $$props) $$invalidate(2, $$scope = $$props.$$scope);
    	};

    	return [title, closeModal, $$scope, slots];
    }

    class Modal extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$l, create_fragment$r, safe_not_equal, { title: 0 });
    	}
    }

    /* src\UI\TextInput.svelte generated by Svelte v3.50.1 */

    function get_each_context$6(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[21] = list[i];
    	return child_ctx;
    }

    // (21:2) {#if label}
    function create_if_block_4$3(ctx) {
    	let label_1;
    	let t;

    	return {
    		c() {
    			label_1 = element("label");
    			t = text(/*label*/ ctx[2]);
    			this.h();
    		},
    		l(nodes) {
    			label_1 = claim_element(nodes, "LABEL", { for: true, class: true });
    			var label_1_nodes = children(label_1);
    			t = claim_text(label_1_nodes, /*label*/ ctx[2]);
    			label_1_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(label_1, "for", /*id*/ ctx[1]);
    			attr(label_1, "class", "svelte-11idp0");
    		},
    		m(target, anchor) {
    			insert_hydration(target, label_1, anchor);
    			append_hydration(label_1, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*label*/ 4) set_data(t, /*label*/ ctx[2]);

    			if (dirty & /*id*/ 2) {
    				attr(label_1, "for", /*id*/ ctx[1]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(label_1);
    		}
    	};
    }

    // (24:2) {#if controlType === "textarea"}
    function create_if_block_3$4(ctx) {
    	let textarea;
    	let textarea_class_value;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			textarea = element("textarea");
    			this.h();
    		},
    		l(nodes) {
    			textarea = claim_element(nodes, "TEXTAREA", {
    				class: true,
    				rows: true,
    				id: true,
    				placeholder: true
    			});

    			children(textarea).forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(textarea, "class", textarea_class_value = "" + (null_to_empty(/*resize*/ ctx[4] ? "textarea-resize" : "") + " svelte-11idp0"));
    			attr(textarea, "rows", /*rows*/ ctx[3]);
    			attr(textarea, "id", /*id*/ ctx[1]);
    			textarea.value = /*value*/ ctx[5];
    			attr(textarea, "placeholder", /*placeholder*/ ctx[7]);
    			textarea.readOnly = /*readonly*/ ctx[11];
    			textarea.disabled = /*disable*/ ctx[12];
    			toggle_class(textarea, "invalid", !/*valid*/ ctx[8] && /*touched*/ ctx[14]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, textarea, anchor);

    			if (!mounted) {
    				dispose = [
    					listen(textarea, "input", /*input_handler*/ ctx[17]),
    					listen(textarea, "blur", /*blur_handler*/ ctx[18])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*resize*/ 16 && textarea_class_value !== (textarea_class_value = "" + (null_to_empty(/*resize*/ ctx[4] ? "textarea-resize" : "") + " svelte-11idp0"))) {
    				attr(textarea, "class", textarea_class_value);
    			}

    			if (dirty & /*rows*/ 8) {
    				attr(textarea, "rows", /*rows*/ ctx[3]);
    			}

    			if (dirty & /*id*/ 2) {
    				attr(textarea, "id", /*id*/ ctx[1]);
    			}

    			if (dirty & /*value, grouplist*/ 1056) {
    				textarea.value = /*value*/ ctx[5];
    			}

    			if (dirty & /*placeholder*/ 128) {
    				attr(textarea, "placeholder", /*placeholder*/ ctx[7]);
    			}

    			if (dirty & /*readonly*/ 2048) {
    				textarea.readOnly = /*readonly*/ ctx[11];
    			}

    			if (dirty & /*disable*/ 4096) {
    				textarea.disabled = /*disable*/ ctx[12];
    			}

    			if (dirty & /*resize, valid, touched*/ 16656) {
    				toggle_class(textarea, "invalid", !/*valid*/ ctx[8] && /*touched*/ ctx[14]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(textarea);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (39:2) {#if controlType === "select"}
    function create_if_block_2$5(ctx) {
    	let select;
    	let mounted;
    	let dispose;
    	let each_value = /*grouplist*/ ctx[10];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$6(get_each_context$6(ctx, each_value, i));
    	}

    	return {
    		c() {
    			select = element("select");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.h();
    		},
    		l(nodes) {
    			select = claim_element(nodes, "SELECT", {
    				id: true,
    				placeholder: true,
    				readonly: true,
    				class: true
    			});

    			var select_nodes = children(select);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(select_nodes);
    			}

    			select_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(select, "id", /*id*/ ctx[1]);
    			attr(select, "placeholder", /*placeholder*/ ctx[7]);
    			attr(select, "readonly", /*readonly*/ ctx[11]);
    			attr(select, "class", "svelte-11idp0");
    			toggle_class(select, "invalid", !/*valid*/ ctx[8] && /*touched*/ ctx[14]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, select, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(select, null);
    			}

    			select_option(select, /*value*/ ctx[5]);

    			if (!mounted) {
    				dispose = [
    					listen(select, "input", /*input_handler_1*/ ctx[16]),
    					listen(select, "blur", /*blur_handler_1*/ ctx[19])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*grouplist*/ 1024) {
    				each_value = /*grouplist*/ ctx[10];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$6(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$6(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*id*/ 2) {
    				attr(select, "id", /*id*/ ctx[1]);
    			}

    			if (dirty & /*value, grouplist*/ 1056) {
    				select_option(select, /*value*/ ctx[5]);
    			}

    			if (dirty & /*placeholder*/ 128) {
    				attr(select, "placeholder", /*placeholder*/ ctx[7]);
    			}

    			if (dirty & /*readonly*/ 2048) {
    				attr(select, "readonly", /*readonly*/ ctx[11]);
    			}

    			if (dirty & /*valid, touched*/ 16640) {
    				toggle_class(select, "invalid", !/*valid*/ ctx[8] && /*touched*/ ctx[14]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(select);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (49:6) {#each grouplist as group}
    function create_each_block$6(ctx) {
    	let option;
    	let t0_value = /*group*/ ctx[21] + "";
    	let t0;
    	let t1;
    	let option_value_value;

    	return {
    		c() {
    			option = element("option");
    			t0 = text(t0_value);
    			t1 = space();
    			this.h();
    		},
    		l(nodes) {
    			option = claim_element(nodes, "OPTION", {});
    			var option_nodes = children(option);
    			t0 = claim_text(option_nodes, t0_value);
    			t1 = claim_space(option_nodes);
    			option_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			option.__value = option_value_value = /*group*/ ctx[21];
    			option.value = option.__value;
    		},
    		m(target, anchor) {
    			insert_hydration(target, option, anchor);
    			append_hydration(option, t0);
    			append_hydration(option, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*grouplist*/ 1024 && t0_value !== (t0_value = /*group*/ ctx[21] + "")) set_data(t0, t0_value);

    			if (dirty & /*grouplist*/ 1024 && option_value_value !== (option_value_value = /*group*/ ctx[21])) {
    				option.__value = option_value_value;
    				option.value = option.__value;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(option);
    		}
    	};
    }

    // (56:2) {#if controlType === null}
    function create_if_block_1$5(ctx) {
    	let input;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			input = element("input");
    			this.h();
    		},
    		l(nodes) {
    			input = claim_element(nodes, "INPUT", {
    				type: true,
    				id: true,
    				placeholder: true,
    				min: true,
    				class: true
    			});

    			this.h();
    		},
    		h() {
    			input.disabled = /*disable*/ ctx[12];
    			attr(input, "type", /*type*/ ctx[6]);
    			attr(input, "id", /*id*/ ctx[1]);
    			input.value = /*value*/ ctx[5];
    			attr(input, "placeholder", /*placeholder*/ ctx[7]);
    			input.readOnly = /*readonly*/ ctx[11];
    			attr(input, "min", /*min*/ ctx[13]);
    			attr(input, "class", "svelte-11idp0");
    			toggle_class(input, "invalid", !/*valid*/ ctx[8] && /*touched*/ ctx[14]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, input, anchor);

    			if (!mounted) {
    				dispose = [
    					listen(input, "input", /*input_handler_2*/ ctx[15]),
    					listen(input, "blur", /*blur_handler_2*/ ctx[20])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*disable*/ 4096) {
    				input.disabled = /*disable*/ ctx[12];
    			}

    			if (dirty & /*type*/ 64) {
    				attr(input, "type", /*type*/ ctx[6]);
    			}

    			if (dirty & /*id*/ 2) {
    				attr(input, "id", /*id*/ ctx[1]);
    			}

    			if (dirty & /*value, grouplist*/ 1056 && input.value !== /*value*/ ctx[5]) {
    				input.value = /*value*/ ctx[5];
    			}

    			if (dirty & /*placeholder*/ 128) {
    				attr(input, "placeholder", /*placeholder*/ ctx[7]);
    			}

    			if (dirty & /*readonly*/ 2048) {
    				input.readOnly = /*readonly*/ ctx[11];
    			}

    			if (dirty & /*min*/ 8192) {
    				attr(input, "min", /*min*/ ctx[13]);
    			}

    			if (dirty & /*valid, touched*/ 16640) {
    				toggle_class(input, "invalid", !/*valid*/ ctx[8] && /*touched*/ ctx[14]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(input);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (70:2) {#if validityMessage && !valid && touched}
    function create_if_block$6(ctx) {
    	let p;
    	let t;

    	return {
    		c() {
    			p = element("p");
    			t = text(/*validityMessage*/ ctx[9]);
    			this.h();
    		},
    		l(nodes) {
    			p = claim_element(nodes, "P", { class: true });
    			var p_nodes = children(p);
    			t = claim_text(p_nodes, /*validityMessage*/ ctx[9]);
    			p_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(p, "class", "error-message svelte-11idp0");
    		},
    		m(target, anchor) {
    			insert_hydration(target, p, anchor);
    			append_hydration(p, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*validityMessage*/ 512) set_data(t, /*validityMessage*/ ctx[9]);
    		},
    		d(detaching) {
    			if (detaching) detach(p);
    		}
    	};
    }

    function create_fragment$q(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let t2;
    	let t3;
    	let if_block0 = /*label*/ ctx[2] && create_if_block_4$3(ctx);
    	let if_block1 = /*controlType*/ ctx[0] === "textarea" && create_if_block_3$4(ctx);
    	let if_block2 = /*controlType*/ ctx[0] === "select" && create_if_block_2$5(ctx);
    	let if_block3 = /*controlType*/ ctx[0] === null && create_if_block_1$5(ctx);
    	let if_block4 = /*validityMessage*/ ctx[9] && !/*valid*/ ctx[8] && /*touched*/ ctx[14] && create_if_block$6(ctx);

    	return {
    		c() {
    			div = element("div");
    			if (if_block0) if_block0.c();
    			t0 = space();
    			if (if_block1) if_block1.c();
    			t1 = space();
    			if (if_block2) if_block2.c();
    			t2 = space();
    			if (if_block3) if_block3.c();
    			t3 = space();
    			if (if_block4) if_block4.c();
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			if (if_block0) if_block0.l(div_nodes);
    			t0 = claim_space(div_nodes);
    			if (if_block1) if_block1.l(div_nodes);
    			t1 = claim_space(div_nodes);
    			if (if_block2) if_block2.l(div_nodes);
    			t2 = claim_space(div_nodes);
    			if (if_block3) if_block3.l(div_nodes);
    			t3 = claim_space(div_nodes);
    			if (if_block4) if_block4.l(div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "form-control svelte-11idp0");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			if (if_block0) if_block0.m(div, null);
    			append_hydration(div, t0);
    			if (if_block1) if_block1.m(div, null);
    			append_hydration(div, t1);
    			if (if_block2) if_block2.m(div, null);
    			append_hydration(div, t2);
    			if (if_block3) if_block3.m(div, null);
    			append_hydration(div, t3);
    			if (if_block4) if_block4.m(div, null);
    		},
    		p(ctx, [dirty]) {
    			if (/*label*/ ctx[2]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_4$3(ctx);
    					if_block0.c();
    					if_block0.m(div, t0);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*controlType*/ ctx[0] === "textarea") {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_3$4(ctx);
    					if_block1.c();
    					if_block1.m(div, t1);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (/*controlType*/ ctx[0] === "select") {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);
    				} else {
    					if_block2 = create_if_block_2$5(ctx);
    					if_block2.c();
    					if_block2.m(div, t2);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (/*controlType*/ ctx[0] === null) {
    				if (if_block3) {
    					if_block3.p(ctx, dirty);
    				} else {
    					if_block3 = create_if_block_1$5(ctx);
    					if_block3.c();
    					if_block3.m(div, t3);
    				}
    			} else if (if_block3) {
    				if_block3.d(1);
    				if_block3 = null;
    			}

    			if (/*validityMessage*/ ctx[9] && !/*valid*/ ctx[8] && /*touched*/ ctx[14]) {
    				if (if_block4) {
    					if_block4.p(ctx, dirty);
    				} else {
    					if_block4 = create_if_block$6(ctx);
    					if_block4.c();
    					if_block4.m(div, null);
    				}
    			} else if (if_block4) {
    				if_block4.d(1);
    				if_block4 = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if (if_block2) if_block2.d();
    			if (if_block3) if_block3.d();
    			if (if_block4) if_block4.d();
    		}
    	};
    }

    function instance$k($$self, $$props, $$invalidate) {
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

    	function input_handler_2(event) {
    		bubble.call(this, $$self, event);
    	}

    	function input_handler_1(event) {
    		bubble.call(this, $$self, event);
    	}

    	function input_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	const blur_handler = () => $$invalidate(14, touched = true);
    	const blur_handler_1 = () => $$invalidate(14, touched = true);
    	const blur_handler_2 = () => $$invalidate(14, touched = true);

    	$$self.$$set = $$props => {
    		if ('controlType' in $$props) $$invalidate(0, controlType = $$props.controlType);
    		if ('id' in $$props) $$invalidate(1, id = $$props.id);
    		if ('label' in $$props) $$invalidate(2, label = $$props.label);
    		if ('rows' in $$props) $$invalidate(3, rows = $$props.rows);
    		if ('resize' in $$props) $$invalidate(4, resize = $$props.resize);
    		if ('value' in $$props) $$invalidate(5, value = $$props.value);
    		if ('type' in $$props) $$invalidate(6, type = $$props.type);
    		if ('placeholder' in $$props) $$invalidate(7, placeholder = $$props.placeholder);
    		if ('valid' in $$props) $$invalidate(8, valid = $$props.valid);
    		if ('validityMessage' in $$props) $$invalidate(9, validityMessage = $$props.validityMessage);
    		if ('grouplist' in $$props) $$invalidate(10, grouplist = $$props.grouplist);
    		if ('readonly' in $$props) $$invalidate(11, readonly = $$props.readonly);
    		if ('disable' in $$props) $$invalidate(12, disable = $$props.disable);
    		if ('min' in $$props) $$invalidate(13, min = $$props.min);
    	};

    	return [
    		controlType,
    		id,
    		label,
    		rows,
    		resize,
    		value,
    		type,
    		placeholder,
    		valid,
    		validityMessage,
    		grouplist,
    		readonly,
    		disable,
    		min,
    		touched,
    		input_handler_2,
    		input_handler_1,
    		input_handler,
    		blur_handler,
    		blur_handler_1,
    		blur_handler_2
    	];
    }

    class TextInput extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$k, create_fragment$q, safe_not_equal, {
    			controlType: 0,
    			id: 1,
    			label: 2,
    			rows: 3,
    			resize: 4,
    			value: 5,
    			type: 6,
    			placeholder: 7,
    			valid: 8,
    			validityMessage: 9,
    			grouplist: 10,
    			readonly: 11,
    			disable: 12,
    			min: 13
    		});
    	}
    }

    /* src\UI\TaskForm.svelte generated by Svelte v3.50.1 */

    function get_each_context_1$2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[22] = list[i];
    	return child_ctx;
    }

    function get_each_context$5(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[22] = list[i];
    	return child_ctx;
    }

    // (137:2) {#if task.taskstate == "open"}
    function create_if_block_4$2(ctx) {
    	let div;
    	let p;
    	let t0;
    	let t1;

    	function select_block_type(ctx, dirty) {
    		if (/*selectedplan*/ ctx[5] == "") return create_if_block_5$2;
    		return create_else_block$3;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			div = element("div");
    			p = element("p");
    			t0 = text("Plan:");
    			t1 = space();
    			if_block.c();
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			p = claim_element(div_nodes, "P", {});
    			var p_nodes = children(p);
    			t0 = claim_text(p_nodes, "Plan:");
    			p_nodes.forEach(detach);
    			t1 = claim_space(div_nodes);
    			if_block.l(div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "planSelection svelte-1enhzbe");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			append_hydration(div, p);
    			append_hydration(p, t0);
    			append_hydration(div, t1);
    			if_block.m(div, null);
    		},
    		p(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(div, null);
    				}
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if_block.d();
    		}
    	};
    }

    // (147:8) {:else}
    function create_else_block$3(ctx) {
    	let select;
    	let option;
    	let t;
    	let mounted;
    	let dispose;
    	let each_value_1 = /*filteredplans*/ ctx[2];
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1$2(get_each_context_1$2(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			select = element("select");
    			option = element("option");
    			t = text("None");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.h();
    		},
    		l(nodes) {
    			select = claim_element(nodes, "SELECT", { default: true });
    			var select_nodes = children(select);
    			option = claim_element(select_nodes, "OPTION", {});
    			var option_nodes = children(option);
    			t = claim_text(option_nodes, "None");
    			option_nodes.forEach(detach);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(select_nodes);
    			}

    			select_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			option.__value = "";
    			option.value = option.__value;
    			attr(select, "default", /*selectedplan*/ ctx[5]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, select, anchor);
    			append_hydration(select, option);
    			append_hydration(option, t);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(select, null);
    			}

    			if (!mounted) {
    				dispose = listen(select, "change", /*handleSelectPlan*/ ctx[10]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*filteredplans, selectedplan*/ 36) {
    				each_value_1 = /*filteredplans*/ ctx[2];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1$2(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1$2(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}

    			if (dirty & /*selectedplan*/ 32) {
    				attr(select, "default", /*selectedplan*/ ctx[5]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(select);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (140:8) {#if selectedplan == ""}
    function create_if_block_5$2(ctx) {
    	let select;
    	let option;
    	let t;
    	let mounted;
    	let dispose;
    	let each_value = /*filteredplans*/ ctx[2];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$5(get_each_context$5(ctx, each_value, i));
    	}

    	return {
    		c() {
    			select = element("select");
    			option = element("option");
    			t = text("None");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.h();
    		},
    		l(nodes) {
    			select = claim_element(nodes, "SELECT", {});
    			var select_nodes = children(select);
    			option = claim_element(select_nodes, "OPTION", {});
    			var option_nodes = children(option);
    			t = claim_text(option_nodes, "None");
    			option_nodes.forEach(detach);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(select_nodes);
    			}

    			select_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			option.__value = "";
    			option.value = option.__value;
    			option.selected = "selected";
    		},
    		m(target, anchor) {
    			insert_hydration(target, select, anchor);
    			append_hydration(select, option);
    			append_hydration(option, t);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(select, null);
    			}

    			if (!mounted) {
    				dispose = listen(select, "change", /*handleSelectPlan*/ ctx[10]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*filteredplans*/ 4) {
    				each_value = /*filteredplans*/ ctx[2];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$5(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$5(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(select);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (153:14) {:else}
    function create_else_block_1$2(ctx) {
    	let option;
    	let t_value = /*p*/ ctx[22] + "";
    	let t;
    	let option_value_value;

    	return {
    		c() {
    			option = element("option");
    			t = text(t_value);
    			this.h();
    		},
    		l(nodes) {
    			option = claim_element(nodes, "OPTION", {});
    			var option_nodes = children(option);
    			t = claim_text(option_nodes, t_value);
    			option_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			option.__value = option_value_value = /*p*/ ctx[22];
    			option.value = option.__value;
    		},
    		m(target, anchor) {
    			insert_hydration(target, option, anchor);
    			append_hydration(option, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*filteredplans*/ 4 && t_value !== (t_value = /*p*/ ctx[22] + "")) set_data(t, t_value);

    			if (dirty & /*filteredplans*/ 4 && option_value_value !== (option_value_value = /*p*/ ctx[22])) {
    				option.__value = option_value_value;
    				option.value = option.__value;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(option);
    		}
    	};
    }

    // (151:14) {#if p == selectedplan}
    function create_if_block_6$2(ctx) {
    	let option;
    	let t_value = /*p*/ ctx[22] + "";
    	let t;
    	let option_value_value;

    	return {
    		c() {
    			option = element("option");
    			t = text(t_value);
    			this.h();
    		},
    		l(nodes) {
    			option = claim_element(nodes, "OPTION", {});
    			var option_nodes = children(option);
    			t = claim_text(option_nodes, t_value);
    			option_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			option.__value = option_value_value = /*p*/ ctx[22];
    			option.value = option.__value;
    			option.selected = "selected";
    		},
    		m(target, anchor) {
    			insert_hydration(target, option, anchor);
    			append_hydration(option, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*filteredplans*/ 4 && t_value !== (t_value = /*p*/ ctx[22] + "")) set_data(t, t_value);

    			if (dirty & /*filteredplans*/ 4 && option_value_value !== (option_value_value = /*p*/ ctx[22])) {
    				option.__value = option_value_value;
    				option.value = option.__value;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(option);
    		}
    	};
    }

    // (150:12) {#each filteredplans as p}
    function create_each_block_1$2(ctx) {
    	let if_block_anchor;

    	function select_block_type_1(ctx, dirty) {
    		if (/*p*/ ctx[22] == /*selectedplan*/ ctx[5]) return create_if_block_6$2;
    		return create_else_block_1$2;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (143:12) {#each filteredplans as p}
    function create_each_block$5(ctx) {
    	let option;
    	let t_value = /*p*/ ctx[22] + "";
    	let t;
    	let option_value_value;

    	return {
    		c() {
    			option = element("option");
    			t = text(t_value);
    			this.h();
    		},
    		l(nodes) {
    			option = claim_element(nodes, "OPTION", {});
    			var option_nodes = children(option);
    			t = claim_text(option_nodes, t_value);
    			option_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			option.__value = option_value_value = /*p*/ ctx[22];
    			option.value = option.__value;
    		},
    		m(target, anchor) {
    			insert_hydration(target, option, anchor);
    			append_hydration(option, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*filteredplans*/ 4 && t_value !== (t_value = /*p*/ ctx[22] + "")) set_data(t, t_value);

    			if (dirty & /*filteredplans*/ 4 && option_value_value !== (option_value_value = /*p*/ ctx[22])) {
    				option.__value = option_value_value;
    				option.value = option.__value;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(option);
    		}
    	};
    }

    // (172:6) <Button disabled={!(diff && task.taskstate != "closed")} mode="outline" on:click={handleEdit}>
    function create_default_slot_5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Edit");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Edit");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (184:4) {#if task.taskstate != "closed"}
    function create_if_block_3$3(ctx) {
    	let textinput;
    	let t;
    	let div;
    	let button;
    	let current;

    	textinput = new TextInput({
    			props: {
    				id: "addnotes",
    				controlType: "textarea",
    				placeholder: "Enter new task notes",
    				rows: "4",
    				resize: true
    			}
    		});

    	textinput.$on("input", /*newNoteChange*/ ctx[8]);

    	button = new Button({
    			props: {
    				mode: "outline",
    				disabled: /*addNoteDisable*/ ctx[3],
    				$$slots: { default: [create_default_slot_4] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*addNoteSubmit*/ ctx[9]);

    	return {
    		c() {
    			create_component(textinput.$$.fragment);
    			t = space();
    			div = element("div");
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			claim_component(textinput.$$.fragment, nodes);
    			t = claim_space(nodes);
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			claim_component(button.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "btn svelte-1enhzbe");
    		},
    		m(target, anchor) {
    			mount_component(textinput, target, anchor);
    			insert_hydration(target, t, anchor);
    			insert_hydration(target, div, anchor);
    			mount_component(button, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};
    			if (dirty & /*addNoteDisable*/ 8) button_changes.disabled = /*addNoteDisable*/ ctx[3];

    			if (dirty & /*$$scope*/ 134217728) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput.$$.fragment, local);
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput.$$.fragment, local);
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(textinput, detaching);
    			if (detaching) detach(t);
    			if (detaching) detach(div);
    			destroy_component(button);
    		}
    	};
    }

    // (194:8) <Button on:click={addNoteSubmit} mode="outline" disabled={addNoteDisable}            >
    function create_default_slot_4(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Add Notes");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Add Notes");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (201:4) <Button on:click={handleClose} mode="danger">
    function create_default_slot_3$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Close");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Close");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (202:4) {#if show}
    function create_if_block$5(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*task*/ ctx[0].taskstate != "closed" && create_if_block_1$4(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*task*/ ctx[0].taskstate != "closed") {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*task*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_1$4(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (203:4) {#if task.taskstate != "closed"}
    function create_if_block_1$4(ctx) {
    	let div;
    	let t;
    	let button;
    	let current;
    	let if_block = (/*task*/ ctx[0].taskstate == "doing" || /*task*/ ctx[0].taskstate == "done") && create_if_block_2$4(ctx);

    	button = new Button({
    			props: {
    				$$slots: { default: [create_default_slot_1$a] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*handlePromote*/ ctx[11]);

    	return {
    		c() {
    			div = element("div");
    			if (if_block) if_block.c();
    			t = space();
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			if (if_block) if_block.l(div_nodes);
    			t = claim_space(div_nodes);
    			claim_component(button.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "btn-right");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			if (if_block) if_block.m(div, null);
    			append_hydration(div, t);
    			mount_component(button, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*task*/ ctx[0].taskstate == "doing" || /*task*/ ctx[0].taskstate == "done") {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*task*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_2$4(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, t);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}

    			const button_changes = {};

    			if (dirty & /*$$scope*/ 134217728) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			destroy_component(button);
    		}
    	};
    }

    // (205:8) {#if task.taskstate == "doing" || task.taskstate == "done"}
    function create_if_block_2$4(ctx) {
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				mode: "danger",
    				$$slots: { default: [create_default_slot_2$5] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*handleDemote*/ ctx[12]);

    	return {
    		c() {
    			create_component(button.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(button.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(button, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty & /*$$scope*/ 134217728) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(button, detaching);
    		}
    	};
    }

    // (206:10) <Button on:click={handleDemote} mode="danger">
    function create_default_slot_2$5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Demote");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Demote");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (208:8) <Button on:click={handlePromote}>
    function create_default_slot_1$a(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Promote");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Promote");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (133:0) <Modal on:close title={task.taskname}>
    function create_default_slot$d(ctx) {
    	let div0;
    	let p;
    	let t0;
    	let t1_value = /*task*/ ctx[0].createdate + "";
    	let t1;
    	let t2;
    	let t3;
    	let div2;
    	let textinput0;
    	let t4;
    	let div1;
    	let button0;
    	let t5;
    	let textinput1;
    	let t6;
    	let div3;
    	let t7;
    	let div4;
    	let button1;
    	let t8;
    	let current;
    	let if_block0 = /*task*/ ctx[0].taskstate == "open" && create_if_block_4$2(ctx);

    	textinput0 = new TextInput({
    			props: {
    				controlType: "textarea",
    				value: /*task*/ ctx[0].taskdes,
    				placeholder: "Edit description",
    				rows: 4,
    				readonly: /*task*/ ctx[0].taskstate == "closed"
    			}
    		});

    	textinput0.$on("input", /*editDesc*/ ctx[6]);

    	button0 = new Button({
    			props: {
    				disabled: !(/*diff*/ ctx[4] && /*task*/ ctx[0].taskstate != "closed"),
    				mode: "outline",
    				$$slots: { default: [create_default_slot_5] },
    				$$scope: { ctx }
    			}
    		});

    	button0.$on("click", /*handleEdit*/ ctx[7]);

    	textinput1 = new TextInput({
    			props: {
    				id: "tasknotes",
    				controlType: "textarea",
    				readonly: true,
    				rows: 5,
    				resize: true,
    				value: `Task Notes: ${/*task*/ ctx[0].tasknote}`
    			}
    		});

    	let if_block1 = /*task*/ ctx[0].taskstate != "closed" && create_if_block_3$3(ctx);

    	button1 = new Button({
    			props: {
    				mode: "danger",
    				$$slots: { default: [create_default_slot_3$1] },
    				$$scope: { ctx }
    			}
    		});

    	button1.$on("click", /*handleClose*/ ctx[13]);
    	let if_block2 = /*show*/ ctx[1] && create_if_block$5(ctx);

    	return {
    		c() {
    			div0 = element("div");
    			p = element("p");
    			t0 = text("Created on: ");
    			t1 = text(t1_value);
    			t2 = space();
    			if (if_block0) if_block0.c();
    			t3 = space();
    			div2 = element("div");
    			create_component(textinput0.$$.fragment);
    			t4 = space();
    			div1 = element("div");
    			create_component(button0.$$.fragment);
    			t5 = space();
    			create_component(textinput1.$$.fragment);
    			t6 = space();
    			div3 = element("div");
    			if (if_block1) if_block1.c();
    			t7 = space();
    			div4 = element("div");
    			create_component(button1.$$.fragment);
    			t8 = space();
    			if (if_block2) if_block2.c();
    			this.h();
    		},
    		l(nodes) {
    			div0 = claim_element(nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			p = claim_element(div0_nodes, "P", {});
    			var p_nodes = children(p);
    			t0 = claim_text(p_nodes, "Created on: ");
    			t1 = claim_text(p_nodes, t1_value);
    			p_nodes.forEach(detach);
    			div0_nodes.forEach(detach);
    			t2 = claim_space(nodes);
    			if (if_block0) if_block0.l(nodes);
    			t3 = claim_space(nodes);
    			div2 = claim_element(nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			claim_component(textinput0.$$.fragment, div2_nodes);
    			t4 = claim_space(div2_nodes);
    			div1 = claim_element(div2_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			claim_component(button0.$$.fragment, div1_nodes);
    			div1_nodes.forEach(detach);
    			div2_nodes.forEach(detach);
    			t5 = claim_space(nodes);
    			claim_component(textinput1.$$.fragment, nodes);
    			t6 = claim_space(nodes);
    			div3 = claim_element(nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);
    			if (if_block1) if_block1.l(div3_nodes);
    			div3_nodes.forEach(detach);
    			t7 = claim_space(nodes);
    			div4 = claim_element(nodes, "DIV", { class: true });
    			var div4_nodes = children(div4);
    			claim_component(button1.$$.fragment, div4_nodes);
    			t8 = claim_space(div4_nodes);
    			if (if_block2) if_block2.l(div4_nodes);
    			div4_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div0, "class", "taskDate svelte-1enhzbe");
    			attr(div1, "class", "btn svelte-1enhzbe");
    			attr(div2, "class", "editSection svelte-1enhzbe");
    			attr(div3, "class", "addnotecontainer svelte-1enhzbe");
    			attr(div4, "class", "buttonDiv svelte-1enhzbe");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div0, anchor);
    			append_hydration(div0, p);
    			append_hydration(p, t0);
    			append_hydration(p, t1);
    			insert_hydration(target, t2, anchor);
    			if (if_block0) if_block0.m(target, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, div2, anchor);
    			mount_component(textinput0, div2, null);
    			append_hydration(div2, t4);
    			append_hydration(div2, div1);
    			mount_component(button0, div1, null);
    			insert_hydration(target, t5, anchor);
    			mount_component(textinput1, target, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, div3, anchor);
    			if (if_block1) if_block1.m(div3, null);
    			insert_hydration(target, t7, anchor);
    			insert_hydration(target, div4, anchor);
    			mount_component(button1, div4, null);
    			append_hydration(div4, t8);
    			if (if_block2) if_block2.m(div4, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if ((!current || dirty & /*task*/ 1) && t1_value !== (t1_value = /*task*/ ctx[0].createdate + "")) set_data(t1, t1_value);

    			if (/*task*/ ctx[0].taskstate == "open") {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_4$2(ctx);
    					if_block0.c();
    					if_block0.m(t3.parentNode, t3);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			const textinput0_changes = {};
    			if (dirty & /*task*/ 1) textinput0_changes.value = /*task*/ ctx[0].taskdes;
    			if (dirty & /*task*/ 1) textinput0_changes.readonly = /*task*/ ctx[0].taskstate == "closed";
    			textinput0.$set(textinput0_changes);
    			const button0_changes = {};
    			if (dirty & /*diff, task*/ 17) button0_changes.disabled = !(/*diff*/ ctx[4] && /*task*/ ctx[0].taskstate != "closed");

    			if (dirty & /*$$scope*/ 134217728) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const textinput1_changes = {};
    			if (dirty & /*task*/ 1) textinput1_changes.value = `Task Notes: ${/*task*/ ctx[0].tasknote}`;
    			textinput1.$set(textinput1_changes);

    			if (/*task*/ ctx[0].taskstate != "closed") {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);

    					if (dirty & /*task*/ 1) {
    						transition_in(if_block1, 1);
    					}
    				} else {
    					if_block1 = create_if_block_3$3(ctx);
    					if_block1.c();
    					transition_in(if_block1, 1);
    					if_block1.m(div3, null);
    				}
    			} else if (if_block1) {
    				group_outros();

    				transition_out(if_block1, 1, 1, () => {
    					if_block1 = null;
    				});

    				check_outros();
    			}

    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 134217728) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);

    			if (/*show*/ ctx[1]) {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);

    					if (dirty & /*show*/ 2) {
    						transition_in(if_block2, 1);
    					}
    				} else {
    					if_block2 = create_if_block$5(ctx);
    					if_block2.c();
    					transition_in(if_block2, 1);
    					if_block2.m(div4, null);
    				}
    			} else if (if_block2) {
    				group_outros();

    				transition_out(if_block2, 1, 1, () => {
    					if_block2 = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(button0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(if_block1);
    			transition_in(button1.$$.fragment, local);
    			transition_in(if_block2);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(button0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(if_block1);
    			transition_out(button1.$$.fragment, local);
    			transition_out(if_block2);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div0);
    			if (detaching) detach(t2);
    			if (if_block0) if_block0.d(detaching);
    			if (detaching) detach(t3);
    			if (detaching) detach(div2);
    			destroy_component(textinput0);
    			destroy_component(button0);
    			if (detaching) detach(t5);
    			destroy_component(textinput1, detaching);
    			if (detaching) detach(t6);
    			if (detaching) detach(div3);
    			if (if_block1) if_block1.d();
    			if (detaching) detach(t7);
    			if (detaching) detach(div4);
    			destroy_component(button1);
    			if (if_block2) if_block2.d();
    		}
    	};
    }

    function create_fragment$p(ctx) {
    	let modal;
    	let current;

    	modal = new Modal({
    			props: {
    				title: /*task*/ ctx[0].taskname,
    				$$slots: { default: [create_default_slot$d] },
    				$$scope: { ctx }
    			}
    		});

    	modal.$on("close", /*close_handler*/ ctx[16]);

    	return {
    		c() {
    			create_component(modal.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(modal.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(modal, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const modal_changes = {};
    			if (dirty & /*task*/ 1) modal_changes.title = /*task*/ ctx[0].taskname;

    			if (dirty & /*$$scope, task, show, addNoteDisable, diff, filteredplans, selectedplan*/ 134217791) {
    				modal_changes.$$scope = { dirty, ctx };
    			}

    			modal.$set(modal_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(modal.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(modal.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(modal, detaching);
    		}
    	};
    }

    function instance$j($$self, $$props, $$invalidate) {
    	const dispatch = createEventDispatcher();
    	let { task } = $$props;
    	let { oldTaskNote } = $$props;
    	let { show } = $$props;
    	let { filteredplans } = $$props;
    	let { group } = $$props;
    	let editedDescription;
    	let addNoteDisable = true;
    	let diff = false;
    	let old = task.taskdes;
    	let newNote = "";
    	task.tasknote;
    	let selectedplan = task.taskplan;

    	const editDesc = e => {
    		editedDescription = e.target.value;

    		if (e.target.value != old) {
    			$$invalidate(4, diff = true);
    		} else {
    			$$invalidate(4, diff = false);
    		}
    	};

    	const handleEdit = () => {
    		const url = "http://localhost:8080/edittask";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				editor: sessionStorage.getItem("JWT"),
    				group,
    				taskid: task.taskid,
    				taskdes: editedDescription,
    				field: "task_description",
    				taskstate: task.taskstate,
    				olddes: oldTaskNote,
    				tasknote: task.tasknote
    			})
    		}).then(response => response.json()).then(data => {
    			$$invalidate(4, diff = false);
    			dispatch("update");
    			document.getElementById("tasknotes").value = task.tasknote;
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const newNoteChange = e => {
    		newNote = e.target.value;

    		if (newNote.length > 0) {
    			$$invalidate(3, addNoteDisable = false);
    		} else {
    			$$invalidate(3, addNoteDisable = true);
    		}
    	};

    	const addNoteSubmit = () => {
    		//Junhe -- update added task notes only - no des
    		const url = "http://localhost:8080/inserttasknote";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				editor: sessionStorage.getItem("JWT"),
    				group,
    				taskid: task.taskid,
    				taskstate: task.taskstate,
    				taskdes: task.taskdes,
    				olddes: task.taskdes,
    				tasknote: task.tasknote,
    				addedtasknote: newNote
    			})
    		}).then(response => response.json()).then(data => {
    			$$invalidate(4, diff = false);
    			dispatch("update");
    			document.getElementById("tasknotes").value = task.tasknote;
    			newNote = "";
    			document.getElementById("addnotes").value = newNote;
    			$$invalidate(3, addNoteDisable = true);
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const handleSelectPlan = e => {
    		const url = "http://localhost:8080/edittask";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				editor: sessionStorage.getItem("JWT"),
    				group,
    				taskid: task.taskid,
    				taskdes: e.target.value,
    				field: "task_plan",
    				taskstate: task.taskstate,
    				olddes: oldTaskNote,
    				tasknote: task.tasknote
    			})
    		}).then(response => response.json()).then(data => {
    			$$invalidate(5, selectedplan = e.target.value);
    			dispatch("update");
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const handlePromote = () => {
    		dispatch("promote");
    	}; //close form
    	//get new data update dashboard

    	const handleDemote = () => {
    		dispatch("demote");
    	}; //closeform
    	//demote api call udpate

    	const handleClose = () => {
    		dispatch("close");
    	};

    	function close_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('task' in $$props) $$invalidate(0, task = $$props.task);
    		if ('oldTaskNote' in $$props) $$invalidate(14, oldTaskNote = $$props.oldTaskNote);
    		if ('show' in $$props) $$invalidate(1, show = $$props.show);
    		if ('filteredplans' in $$props) $$invalidate(2, filteredplans = $$props.filteredplans);
    		if ('group' in $$props) $$invalidate(15, group = $$props.group);
    	};

    	return [
    		task,
    		show,
    		filteredplans,
    		addNoteDisable,
    		diff,
    		selectedplan,
    		editDesc,
    		handleEdit,
    		newNoteChange,
    		addNoteSubmit,
    		handleSelectPlan,
    		handlePromote,
    		handleDemote,
    		handleClose,
    		oldTaskNote,
    		group,
    		close_handler
    	];
    }

    class TaskForm extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$j, create_fragment$p, safe_not_equal, {
    			task: 0,
    			oldTaskNote: 14,
    			show: 1,
    			filteredplans: 2,
    			group: 15
    		});
    	}
    }

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

    function create_if_block_3$2(ctx) {
    	let taskform;
    	let current;

    	taskform = new TaskForm({
    			props: {
    				task: /*task*/ ctx[0],
    				oldTaskNote: /*task*/ ctx[0].taskdes,
    				filteredplans: /*filteredplans*/ ctx[2],
    				group: /*group*/ ctx[3],
    				show: /*show*/ ctx[6]
    			}
    		});

    	taskform.$on("close", /*closeModal*/ ctx[9]);
    	taskform.$on("update", /*update*/ ctx[12]);
    	taskform.$on("promote", /*promoteTask*/ ctx[10]);
    	taskform.$on("demote", /*demoteTask*/ ctx[11]);

    	return {
    		c() {
    			create_component(taskform.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(taskform.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(taskform, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const taskform_changes = {};
    			if (dirty & /*task*/ 1) taskform_changes.task = /*task*/ ctx[0];
    			if (dirty & /*task*/ 1) taskform_changes.oldTaskNote = /*task*/ ctx[0].taskdes;
    			if (dirty & /*filteredplans*/ 4) taskform_changes.filteredplans = /*filteredplans*/ ctx[2];
    			if (dirty & /*group*/ 8) taskform_changes.group = /*group*/ ctx[3];
    			if (dirty & /*show*/ 64) taskform_changes.show = /*show*/ ctx[6];
    			taskform.$set(taskform_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(taskform.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(taskform.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(taskform, detaching);
    		}
    	};
    }

    // (225:4) {#if show}
    function create_if_block$4(ctx) {
    	let div;
    	let current_block_type_index;
    	let if_block;
    	let current;
    	const if_block_creators = [create_if_block_1$3, create_if_block_2$3];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*task*/ ctx[0].taskstate == "doing" || /*task*/ ctx[0].taskstate == "done") return 0;
    		if (/*task*/ ctx[0].taskstate != "closed") return 1;
    		return -1;
    	}

    	if (~(current_block_type_index = select_block_type(ctx))) {
    		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	}

    	return {
    		c() {
    			div = element("div");
    			if (if_block) if_block.c();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", {});
    			var div_nodes = children(div);
    			if (if_block) if_block.l(div_nodes);
    			div_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);

    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].m(div, null);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if (~current_block_type_index) {
    					if_blocks[current_block_type_index].p(ctx, dirty);
    				}
    			} else {
    				if (if_block) {
    					group_outros();

    					transition_out(if_blocks[previous_block_index], 1, 1, () => {
    						if_blocks[previous_block_index] = null;
    					});

    					check_outros();
    				}

    				if (~current_block_type_index) {
    					if_block = if_blocks[current_block_type_index];

    					if (!if_block) {
    						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    						if_block.c();
    					} else {
    						if_block.p(ctx, dirty);
    					}

    					transition_in(if_block, 1);
    					if_block.m(div, null);
    				} else {
    					if_block = null;
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);

    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].d();
    			}
    		}
    	};
    }

    // (234:45) 
    function create_if_block_2$3(ctx) {
    	let div;
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				$$slots: { default: [create_default_slot_2$4] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*promoteTask*/ ctx[10]);

    	return {
    		c() {
    			div = element("div");
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			claim_component(button.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "over svelte-1bn43x9");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			mount_component(button, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty & /*$$scope*/ 524288) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(button);
    		}
    	};
    }

    // (227:8) {#if task.taskstate == "doing" || task.taskstate == "done"}
    function create_if_block_1$3(ctx) {
    	let div0;
    	let button0;
    	let t;
    	let div1;
    	let button1;
    	let current;

    	button0 = new Button({
    			props: {
    				$$slots: { default: [create_default_slot_1$9] },
    				$$scope: { ctx }
    			}
    		});

    	button0.$on("click", /*demoteTask*/ ctx[11]);

    	button1 = new Button({
    			props: {
    				$$slots: { default: [create_default_slot$c] },
    				$$scope: { ctx }
    			}
    		});

    	button1.$on("click", /*promoteTask*/ ctx[10]);

    	return {
    		c() {
    			div0 = element("div");
    			create_component(button0.$$.fragment);
    			t = space();
    			div1 = element("div");
    			create_component(button1.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div0 = claim_element(nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			claim_component(button0.$$.fragment, div0_nodes);
    			div0_nodes.forEach(detach);
    			t = claim_space(nodes);
    			div1 = claim_element(nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			claim_component(button1.$$.fragment, div1_nodes);
    			div1_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div0, "class", "btn-sec-left svelte-1bn43x9");
    			attr(div1, "class", "over svelte-1bn43x9");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div0, anchor);
    			mount_component(button0, div0, null);
    			insert_hydration(target, t, anchor);
    			insert_hydration(target, div1, anchor);
    			mount_component(button1, div1, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button0_changes = {};

    			if (dirty & /*$$scope*/ 524288) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 524288) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button0.$$.fragment, local);
    			transition_in(button1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button0.$$.fragment, local);
    			transition_out(button1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div0);
    			destroy_component(button0);
    			if (detaching) detach(t);
    			if (detaching) detach(div1);
    			destroy_component(button1);
    		}
    	};
    }

    // (236:12) <Button on:click={promoteTask}>
    function create_default_slot_2$4(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("🡢");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "🡢");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (229:12) <Button on:click={demoteTask}>
    function create_default_slot_1$9(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("🡠");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "🡠");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (232:12) <Button on:click={promoteTask}>
    function create_default_slot$c(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("🡢");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "🡢");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$o(ctx) {
    	let main;
    	let t0;
    	let div3;
    	let div2;
    	let div1;
    	let span0;
    	let t1;
    	let div0;
    	let p0;
    	let t2_value = /*task*/ ctx[0].taskname + "";
    	let t2;
    	let t3;
    	let p1;
    	let t4;
    	let t5;
    	let t6;
    	let span1;
    	let t7;
    	let current;
    	let mounted;
    	let dispose;
    	let if_block0 = /*modal*/ ctx[4] && create_if_block_3$2(ctx);
    	let if_block1 = /*show*/ ctx[6] && create_if_block$4(ctx);

    	return {
    		c() {
    			main = element("main");
    			if (if_block0) if_block0.c();
    			t0 = space();
    			div3 = element("div");
    			div2 = element("div");
    			div1 = element("div");
    			span0 = element("span");
    			t1 = space();
    			div0 = element("div");
    			p0 = element("p");
    			t2 = text(t2_value);
    			t3 = space();
    			p1 = element("p");
    			t4 = text("Desc: ");
    			t5 = text(/*desc*/ ctx[5]);
    			t6 = space();
    			span1 = element("span");
    			t7 = space();
    			if (if_block1) if_block1.c();
    			this.h();
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			if (if_block0) if_block0.l(main_nodes);
    			t0 = claim_space(main_nodes);
    			div3 = claim_element(main_nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);
    			div2 = claim_element(div3_nodes, "DIV", { class: true, style: true });
    			var div2_nodes = children(div2);
    			div1 = claim_element(div2_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			span0 = claim_element(div1_nodes, "SPAN", { class: true, style: true });
    			children(span0).forEach(detach);
    			t1 = claim_space(div1_nodes);
    			div0 = claim_element(div1_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			p0 = claim_element(div0_nodes, "P", { class: true });
    			var p0_nodes = children(p0);
    			t2 = claim_text(p0_nodes, t2_value);
    			p0_nodes.forEach(detach);
    			t3 = claim_space(div0_nodes);
    			p1 = claim_element(div0_nodes, "P", { class: true });
    			var p1_nodes = children(p1);
    			t4 = claim_text(p1_nodes, "Desc: ");
    			t5 = claim_text(p1_nodes, /*desc*/ ctx[5]);
    			p1_nodes.forEach(detach);
    			div0_nodes.forEach(detach);
    			div1_nodes.forEach(detach);
    			t6 = claim_space(div2_nodes);
    			span1 = claim_element(div2_nodes, "SPAN", { class: true, style: true });
    			children(span1).forEach(detach);
    			div2_nodes.forEach(detach);
    			t7 = claim_space(div3_nodes);
    			if (if_block1) if_block1.l(div3_nodes);
    			div3_nodes.forEach(detach);
    			main_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(span0, "class", "color svelte-1bn43x9");
    			set_style(span0, "background-color", getColor(/*colors*/ ctx[7], /*task*/ ctx[0], 1));
    			attr(p0, "class", "taskname svelte-1bn43x9");
    			attr(p1, "class", "taskdesc svelte-1bn43x9");
    			attr(div0, "class", "right svelte-1bn43x9");
    			attr(div1, "class", "under svelte-1bn43x9");
    			attr(span1, "class", "planColor svelte-1bn43x9");
    			set_style(span1, "background-color", getColor(/*colors*/ ctx[7], /*task*/ ctx[0], 0));
    			attr(div2, "class", "task-container svelte-1bn43x9");
    			set_style(div2, "border-color", /*stateColor*/ ctx[1]);
    			attr(div3, "class", "container svelte-1bn43x9");
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			if (if_block0) if_block0.m(main, null);
    			append_hydration(main, t0);
    			append_hydration(main, div3);
    			append_hydration(div3, div2);
    			append_hydration(div2, div1);
    			append_hydration(div1, span0);
    			append_hydration(div1, t1);
    			append_hydration(div1, div0);
    			append_hydration(div0, p0);
    			append_hydration(p0, t2);
    			append_hydration(div0, t3);
    			append_hydration(div0, p1);
    			append_hydration(p1, t4);
    			append_hydration(p1, t5);
    			append_hydration(div2, t6);
    			append_hydration(div2, span1);
    			append_hydration(div3, t7);
    			if (if_block1) if_block1.m(div3, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(div2, "click", /*showModal*/ ctx[8]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (/*modal*/ ctx[4]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);

    					if (dirty & /*modal*/ 16) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_3$2(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(main, t0);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			if (!current || dirty & /*task*/ 1) {
    				set_style(span0, "background-color", getColor(/*colors*/ ctx[7], /*task*/ ctx[0], 1));
    			}

    			if ((!current || dirty & /*task*/ 1) && t2_value !== (t2_value = /*task*/ ctx[0].taskname + "")) set_data(t2, t2_value);
    			if (!current || dirty & /*desc*/ 32) set_data(t5, /*desc*/ ctx[5]);

    			if (!current || dirty & /*task*/ 1) {
    				set_style(span1, "background-color", getColor(/*colors*/ ctx[7], /*task*/ ctx[0], 0));
    			}

    			if (!current || dirty & /*stateColor*/ 2) {
    				set_style(div2, "border-color", /*stateColor*/ ctx[1]);
    			}

    			if (/*show*/ ctx[6]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);

    					if (dirty & /*show*/ 64) {
    						transition_in(if_block1, 1);
    					}
    				} else {
    					if_block1 = create_if_block$4(ctx);
    					if_block1.c();
    					transition_in(if_block1, 1);
    					if_block1.m(div3, null);
    				}
    			} else if (if_block1) {
    				group_outros();

    				transition_out(if_block1, 1, 1, () => {
    					if_block1 = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block0);
    			transition_in(if_block1);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block0);
    			transition_out(if_block1);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

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

    function instance$i($$self, $$props, $$invalidate) {
    	let $applicationMethods;
    	let $appcolorMethods;
    	component_subscribe($$self, applicationMethods, $$value => $$invalidate(14, $applicationMethods = $$value));
    	component_subscribe($$self, appcolorMethods, $$value => $$invalidate(15, $appcolorMethods = $$value));
    	const colors = $appcolorMethods;
    	const dispatch = createEventDispatcher();
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
    			$$invalidate(5, desc = task.taskdes.substring(0, 15) + "...");
    		} else {
    			$$invalidate(5, desc = task.taskdes);
    		}
    	};

    	const showModal = () => {
    		$$invalidate(4, modal = true);
    	};

    	const closeModal = () => {
    		checkdes();
    		$$invalidate(4, modal = false);
    	};

    	const checkGroup = () => {
    		$$invalidate(4, modal = false);
    		const url = "http://localhost:8080/authorize";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				token: sessionStorage.getItem("JWT"),
    				group
    			})
    		}).then(response => response.json()).then(data => {
    			if (data.Message === "true") {
    				$$invalidate(6, show = true);
    			} else {
    				$$invalidate(6, show = false);
    			}
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const promoteTask = () => {
    		$$invalidate(4, modal = false);
    		const url = "http://localhost:8080/changestate";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				editor: sessionStorage.getItem("JWT"),
    				taskid: task.taskid,
    				direction: 1,
    				taskstate: task.taskstate,
    				group,
    				tasknote: task.tasknote
    			})
    		}).then(response => response.json()).then(data => {
    			dispatch("update");

    			if (data.Code == 408) {
    				alert("You have no permission");
    			}
    		}).then(() => {
    			if (task.taskstate == "doing") {
    				const url = "http://localhost:8080/email";

    				fetch(url, {
    					method: "POST",
    					body: JSON.stringify({
    						editor: sessionStorage.getItem("JWT"),
    						taskid: task.taskid,
    						direction: 1,
    						taskstate: task.taskstate,
    						group,
    						tasknote: task.tasknote
    					})
    				});
    			}
    		}).catch(error => {
    			alert("You have no permission");
    		});
    	};

    	const demoteTask = () => {
    		$$invalidate(4, modal = false);
    		const url = "http://localhost:8080/changestate";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				editor: sessionStorage.getItem("JWT"),
    				taskid: task.taskid,
    				direction: 0,
    				taskstate: task.taskstate,
    				group,
    				tasknote: task.tasknote
    			})
    		}).then(response => response.json()).then(data => {
    			dispatch("update");

    			if (data.Code == 408) {
    				alert("You have no permission");
    			}
    		}).catch(error => {
    			alert("You have no permission");
    		});
    	};

    	const update = () => {
    		dispatch("update");
    		checkdes();
    	};

    	$$self.$$set = $$props => {
    		if ('task' in $$props) $$invalidate(0, task = $$props.task);
    		if ('stateColor' in $$props) $$invalidate(1, stateColor = $$props.stateColor);
    		if ('state' in $$props) $$invalidate(13, state = $$props.state);
    		if ('filteredplans' in $$props) $$invalidate(2, filteredplans = $$props.filteredplans);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*state, $applicationMethods, task*/ 24577) {
    			$$invalidate(3, group = state === undefined
    			? ""
    			: $applicationMethods.filter(e => e.appname === task.taskacronym)[0][state]);
    		}

    		if ($$self.$$.dirty & /*task*/ 1) {
    			{
    				(checkGroup());
    			}
    		}
    	};

    	return [
    		task,
    		stateColor,
    		filteredplans,
    		group,
    		modal,
    		desc,
    		show,
    		colors,
    		showModal,
    		closeModal,
    		promoteTask,
    		demoteTask,
    		update,
    		state,
    		$applicationMethods
    	];
    }

    class Task extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$i, create_fragment$o, safe_not_equal, {
    			task: 0,
    			stateColor: 1,
    			state: 13,
    			filteredplans: 2
    		});
    	}
    }

    /* src\components\CreatePlan.svelte generated by Svelte v3.50.1 */

    function create_default_slot_2$3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Close");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Close");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (130:6) <Button mode="outline" type="submit">
    function create_default_slot_1$8(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Submit");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Submit");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (84:0) <Modal title="Create Plan" on:close>
    function create_default_slot$b(ctx) {
    	let form;
    	let textinput0;
    	let t0;
    	let textinput1;
    	let t1;
    	let textinput2;
    	let t2;
    	let textinput3;
    	let t3;
    	let div;
    	let button0;
    	let t4;
    	let button1;
    	let current;
    	let mounted;
    	let dispose;

    	textinput0 = new TextInput({
    			props: {
    				id: "appname",
    				label: "Application Name",
    				value: /*appselected*/ ctx[0],
    				type: "Text",
    				disable: "true"
    			}
    		});

    	textinput1 = new TextInput({
    			props: {
    				id: "planname",
    				label: "New Plan Name*",
    				value: /*planname*/ ctx[1],
    				type: "Text",
    				placeholder: "Please think of a plan name"
    			}
    		});

    	textinput1.$on("input", /*input_handler*/ ctx[7]);

    	textinput2 = new TextInput({
    			props: {
    				id: "startdate",
    				label: "Start Date*",
    				value: /*startdate*/ ctx[2],
    				type: "Date"
    			}
    		});

    	textinput2.$on("input", /*input_handler_1*/ ctx[8]);

    	textinput3 = new TextInput({
    			props: {
    				id: "enddate",
    				label: "End Date*",
    				value: /*enddate*/ ctx[3],
    				type: "Date"
    			}
    		});

    	textinput3.$on("input", /*input_handler_2*/ ctx[9]);

    	button0 = new Button({
    			props: {
    				mode: "outline",
    				$$slots: { default: [create_default_slot_2$3] },
    				$$scope: { ctx }
    			}
    		});

    	button0.$on("click", /*handleClose*/ ctx[4]);

    	button1 = new Button({
    			props: {
    				mode: "outline",
    				type: "submit",
    				$$slots: { default: [create_default_slot_1$8] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			form = element("form");
    			create_component(textinput0.$$.fragment);
    			t0 = space();
    			create_component(textinput1.$$.fragment);
    			t1 = space();
    			create_component(textinput2.$$.fragment);
    			t2 = space();
    			create_component(textinput3.$$.fragment);
    			t3 = space();
    			div = element("div");
    			create_component(button0.$$.fragment);
    			t4 = space();
    			create_component(button1.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			form = claim_element(nodes, "FORM", {});
    			var form_nodes = children(form);
    			claim_component(textinput0.$$.fragment, form_nodes);
    			t0 = claim_space(form_nodes);
    			claim_component(textinput1.$$.fragment, form_nodes);
    			t1 = claim_space(form_nodes);
    			claim_component(textinput2.$$.fragment, form_nodes);
    			t2 = claim_space(form_nodes);
    			claim_component(textinput3.$$.fragment, form_nodes);
    			t3 = claim_space(form_nodes);
    			div = claim_element(form_nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			claim_component(button0.$$.fragment, div_nodes);
    			t4 = claim_space(div_nodes);
    			claim_component(button1.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			form_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "button-space svelte-pv1rjw");
    		},
    		m(target, anchor) {
    			insert_hydration(target, form, anchor);
    			mount_component(textinput0, form, null);
    			append_hydration(form, t0);
    			mount_component(textinput1, form, null);
    			append_hydration(form, t1);
    			mount_component(textinput2, form, null);
    			append_hydration(form, t2);
    			mount_component(textinput3, form, null);
    			append_hydration(form, t3);
    			append_hydration(form, div);
    			mount_component(button0, div, null);
    			append_hydration(div, t4);
    			mount_component(button1, div, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(form, "submit", prevent_default(/*handleSubmitCreatePlan*/ ctx[5]));
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			const textinput0_changes = {};
    			if (dirty & /*appselected*/ 1) textinput0_changes.value = /*appselected*/ ctx[0];
    			textinput0.$set(textinput0_changes);
    			const textinput1_changes = {};
    			if (dirty & /*planname*/ 2) textinput1_changes.value = /*planname*/ ctx[1];
    			textinput1.$set(textinput1_changes);
    			const textinput2_changes = {};
    			if (dirty & /*startdate*/ 4) textinput2_changes.value = /*startdate*/ ctx[2];
    			textinput2.$set(textinput2_changes);
    			const textinput3_changes = {};
    			if (dirty & /*enddate*/ 8) textinput3_changes.value = /*enddate*/ ctx[3];
    			textinput3.$set(textinput3_changes);
    			const button0_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(textinput2.$$.fragment, local);
    			transition_in(textinput3.$$.fragment, local);
    			transition_in(button0.$$.fragment, local);
    			transition_in(button1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(textinput2.$$.fragment, local);
    			transition_out(textinput3.$$.fragment, local);
    			transition_out(button0.$$.fragment, local);
    			transition_out(button1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(form);
    			destroy_component(textinput0);
    			destroy_component(textinput1);
    			destroy_component(textinput2);
    			destroy_component(textinput3);
    			destroy_component(button0);
    			destroy_component(button1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment$n(ctx) {
    	let main;
    	let modal;
    	let current;

    	modal = new Modal({
    			props: {
    				title: "Create Plan",
    				$$slots: { default: [create_default_slot$b] },
    				$$scope: { ctx }
    			}
    		});

    	modal.$on("close", /*close_handler*/ ctx[10]);

    	return {
    		c() {
    			main = element("main");
    			create_component(modal.$$.fragment);
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			claim_component(modal.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			mount_component(modal, main, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const modal_changes = {};

    			if (dirty & /*$$scope, enddate, startdate, planname, appselected*/ 32783) {
    				modal_changes.$$scope = { dirty, ctx };
    			}

    			modal.$set(modal_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(modal.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(modal.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(modal);
    		}
    	};
    }

    function instance$h($$self, $$props, $$invalidate) {
    	let $applicationMethods;
    	component_subscribe($$self, applicationMethods, $$value => $$invalidate(11, $applicationMethods = $$value));
    	const dispatchEvent = createEventDispatcher();
    	let { appselected } = $$props;
    	let { apps } = $$props;
    	let planname = "";
    	let startdate = "";
    	let enddate = "";

    	//for plan need only permit open can create plan
    	let group = $applicationMethods.filter(e => e.appname === appselected)[0]["permitOpen"];

    	const handleClose = () => {
    		dispatchEvent("close");
    	};

    	const emptyFields = () => {
    		$$invalidate(1, [planname, startdate, enddate] = ["", "", ""], planname, $$invalidate(2, startdate), $$invalidate(3, enddate));
    	};

    	const handleSubmitCreatePlan = () => {
    		if (planname == "") {
    			alert("Planname can't be empty");
    		} else if (apps.includes(planname)) {
    			alert("Plan name not allowed, please select a different plan name");
    		} else if (startdate == "") {
    			alert("Start date can't be empty");
    		} else if (startdate > enddate) {
    			alert("End date can't be empty");
    		} else if (startdate > enddate) {
    			alert("Start date cannot before before the End date");
    		} else if (planname == "allplans") {
    			alert("Please use another planname");
    		} else {
    			const url = "http://localhost:8080/createplan";

    			fetch(url, {
    				method: "POST",
    				body: JSON.stringify({
    					acronym: appselected,
    					planname,
    					startdate,
    					enddate,
    					editor: sessionStorage.getItem("JWT"),
    					group
    				})
    			}).then(response => response.json()).then(data => {
    				console.log(data);

    				if (data.Code != 200) {
    					alert(data.Message);
    				} else {
    					alert("Successfully created plan");
    					appcolorMethods.addPlanColors(planname);
    					dispatchEvent("update");
    				}

    				emptyFields();
    			}).catch(error => {
    				console.log(error);
    			});
    		}
    	};

    	const input_handler = e => {
    		$$invalidate(1, planname = e.target.value);
    	};

    	const input_handler_1 = e => {
    		$$invalidate(2, startdate = e.target.value);
    	};

    	const input_handler_2 = e => {
    		$$invalidate(3, enddate = e.target.value);
    	};

    	function close_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('appselected' in $$props) $$invalidate(0, appselected = $$props.appselected);
    		if ('apps' in $$props) $$invalidate(6, apps = $$props.apps);
    	};

    	return [
    		appselected,
    		planname,
    		startdate,
    		enddate,
    		handleClose,
    		handleSubmitCreatePlan,
    		apps,
    		input_handler,
    		input_handler_1,
    		input_handler_2,
    		close_handler
    	];
    }

    class CreatePlan extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$h, create_fragment$n, safe_not_equal, { appselected: 0, apps: 6 });
    	}
    }

    /* src\components\AppForm.svelte generated by Svelte v3.50.1 */

    function create_default_slot_1$7(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Submit");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Submit");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (155:0) <Modal    title={editapp ? `Edit ${appselected}` : "Create Application"}    on:close    on:submit  >
    function create_default_slot$a(ctx) {
    	let form;
    	let div0;
    	let textinput0;
    	let t0;
    	let textinput1;
    	let t1;
    	let textinput2;
    	let t2;
    	let textinput3;
    	let t3;
    	let textinput4;
    	let t4;
    	let div2;
    	let textinput5;
    	let t5;
    	let textinput6;
    	let t6;
    	let textinput7;
    	let t7;
    	let textinput8;
    	let t8;
    	let textinput9;
    	let t9;
    	let div1;
    	let button;
    	let current;
    	let mounted;
    	let dispose;

    	textinput0 = new TextInput({
    			props: {
    				id: "name",
    				label: "Application Name*",
    				placeholder: "Enter name",
    				value: /*appacronym*/ ctx[3],
    				disable: /*editapp*/ ctx[2]
    			}
    		});

    	textinput0.$on("input", /*input_handler*/ ctx[16]);

    	textinput1 = new TextInput({
    			props: {
    				id: "name",
    				controlType: "textarea",
    				rows: "3",
    				name: "description",
    				label: "Application Description",
    				placeholder: "Enter description",
    				value: /*description*/ ctx[4],
    				disable: /*editapp*/ ctx[2]
    			}
    		});

    	textinput1.$on("input", /*input_handler_1*/ ctx[17]);

    	textinput2 = new TextInput({
    			props: {
    				id: "startdate",
    				name: "startdate",
    				type: "date",
    				label: "Start Date*",
    				value: /*startdate*/ ctx[6],
    				disable: /*editapp*/ ctx[2]
    			}
    		});

    	textinput2.$on("input", /*input_handler_2*/ ctx[18]);

    	textinput3 = new TextInput({
    			props: {
    				id: "enddate",
    				name: "enddate",
    				type: "date",
    				label: "End Date*",
    				value: /*enddate*/ ctx[7],
    				disable: /*editapp*/ ctx[2]
    			}
    		});

    	textinput3.$on("input", /*input_handler_3*/ ctx[19]);

    	textinput4 = new TextInput({
    			props: {
    				id: "runningnumber",
    				type: "number",
    				label: "Running Number*",
    				placeholder: "Enter running number",
    				value: /*rnumber*/ ctx[5],
    				disable: /*editapp*/ ctx[2]
    			}
    		});

    	textinput4.$on("input", /*input_handler_4*/ ctx[20]);

    	textinput5 = new TextInput({
    			props: {
    				label: "Create:",
    				grouplist: /*grouplist*/ ctx[0],
    				controlType: "select",
    				value: /*permitcreate*/ ctx[8]
    			}
    		});

    	textinput5.$on("input", /*input_handler_5*/ ctx[21]);

    	textinput6 = new TextInput({
    			props: {
    				label: "Open:",
    				grouplist: /*grouplist*/ ctx[0],
    				controlType: "select",
    				value: /*permitopen*/ ctx[11]
    			}
    		});

    	textinput6.$on("input", /*input_handler_6*/ ctx[22]);

    	textinput7 = new TextInput({
    			props: {
    				label: "To-Do:",
    				grouplist: /*grouplist*/ ctx[0],
    				controlType: "select",
    				value: /*permittodo*/ ctx[12]
    			}
    		});

    	textinput7.$on("input", /*input_handler_7*/ ctx[23]);

    	textinput8 = new TextInput({
    			props: {
    				label: "Doing:",
    				grouplist: /*grouplist*/ ctx[0],
    				controlType: "select",
    				value: /*permitdoing*/ ctx[9]
    			}
    		});

    	textinput8.$on("input", /*input_handler_8*/ ctx[24]);

    	textinput9 = new TextInput({
    			props: {
    				label: "Done:",
    				grouplist: /*grouplist*/ ctx[0],
    				controlType: "select",
    				value: /*permitdone*/ ctx[10]
    			}
    		});

    	textinput9.$on("input", /*input_handler_9*/ ctx[25]);

    	button = new Button({
    			props: {
    				type: "submit",
    				mode: "outline",
    				$$slots: { default: [create_default_slot_1$7] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			form = element("form");
    			div0 = element("div");
    			create_component(textinput0.$$.fragment);
    			t0 = space();
    			create_component(textinput1.$$.fragment);
    			t1 = space();
    			create_component(textinput2.$$.fragment);
    			t2 = space();
    			create_component(textinput3.$$.fragment);
    			t3 = space();
    			create_component(textinput4.$$.fragment);
    			t4 = space();
    			div2 = element("div");
    			create_component(textinput5.$$.fragment);
    			t5 = space();
    			create_component(textinput6.$$.fragment);
    			t6 = space();
    			create_component(textinput7.$$.fragment);
    			t7 = space();
    			create_component(textinput8.$$.fragment);
    			t8 = space();
    			create_component(textinput9.$$.fragment);
    			t9 = space();
    			div1 = element("div");
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			form = claim_element(nodes, "FORM", { class: true });
    			var form_nodes = children(form);
    			div0 = claim_element(form_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			claim_component(textinput0.$$.fragment, div0_nodes);
    			t0 = claim_space(div0_nodes);
    			claim_component(textinput1.$$.fragment, div0_nodes);
    			t1 = claim_space(div0_nodes);
    			claim_component(textinput2.$$.fragment, div0_nodes);
    			t2 = claim_space(div0_nodes);
    			claim_component(textinput3.$$.fragment, div0_nodes);
    			t3 = claim_space(div0_nodes);
    			claim_component(textinput4.$$.fragment, div0_nodes);
    			div0_nodes.forEach(detach);
    			t4 = claim_space(form_nodes);
    			div2 = claim_element(form_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			claim_component(textinput5.$$.fragment, div2_nodes);
    			t5 = claim_space(div2_nodes);
    			claim_component(textinput6.$$.fragment, div2_nodes);
    			t6 = claim_space(div2_nodes);
    			claim_component(textinput7.$$.fragment, div2_nodes);
    			t7 = claim_space(div2_nodes);
    			claim_component(textinput8.$$.fragment, div2_nodes);
    			t8 = claim_space(div2_nodes);
    			claim_component(textinput9.$$.fragment, div2_nodes);
    			t9 = claim_space(div2_nodes);
    			div1 = claim_element(div2_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			claim_component(button.$$.fragment, div1_nodes);
    			div1_nodes.forEach(detach);
    			div2_nodes.forEach(detach);
    			form_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div0, "class", "form-section svelte-t151hz");
    			attr(div1, "class", "btn-container  svelte-t151hz");
    			attr(div2, "class", "form-section svelte-t151hz");
    			attr(form, "class", "app-form svelte-t151hz");
    		},
    		m(target, anchor) {
    			insert_hydration(target, form, anchor);
    			append_hydration(form, div0);
    			mount_component(textinput0, div0, null);
    			append_hydration(div0, t0);
    			mount_component(textinput1, div0, null);
    			append_hydration(div0, t1);
    			mount_component(textinput2, div0, null);
    			append_hydration(div0, t2);
    			mount_component(textinput3, div0, null);
    			append_hydration(div0, t3);
    			mount_component(textinput4, div0, null);
    			append_hydration(form, t4);
    			append_hydration(form, div2);
    			mount_component(textinput5, div2, null);
    			append_hydration(div2, t5);
    			mount_component(textinput6, div2, null);
    			append_hydration(div2, t6);
    			mount_component(textinput7, div2, null);
    			append_hydration(div2, t7);
    			mount_component(textinput8, div2, null);
    			append_hydration(div2, t8);
    			mount_component(textinput9, div2, null);
    			append_hydration(div2, t9);
    			append_hydration(div2, div1);
    			mount_component(button, div1, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(form, "submit", prevent_default(/*submitHandler*/ ctx[13]));
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			const textinput0_changes = {};
    			if (dirty[0] & /*appacronym*/ 8) textinput0_changes.value = /*appacronym*/ ctx[3];
    			if (dirty[0] & /*editapp*/ 4) textinput0_changes.disable = /*editapp*/ ctx[2];
    			textinput0.$set(textinput0_changes);
    			const textinput1_changes = {};
    			if (dirty[0] & /*description*/ 16) textinput1_changes.value = /*description*/ ctx[4];
    			if (dirty[0] & /*editapp*/ 4) textinput1_changes.disable = /*editapp*/ ctx[2];
    			textinput1.$set(textinput1_changes);
    			const textinput2_changes = {};
    			if (dirty[0] & /*startdate*/ 64) textinput2_changes.value = /*startdate*/ ctx[6];
    			if (dirty[0] & /*editapp*/ 4) textinput2_changes.disable = /*editapp*/ ctx[2];
    			textinput2.$set(textinput2_changes);
    			const textinput3_changes = {};
    			if (dirty[0] & /*enddate*/ 128) textinput3_changes.value = /*enddate*/ ctx[7];
    			if (dirty[0] & /*editapp*/ 4) textinput3_changes.disable = /*editapp*/ ctx[2];
    			textinput3.$set(textinput3_changes);
    			const textinput4_changes = {};
    			if (dirty[0] & /*rnumber*/ 32) textinput4_changes.value = /*rnumber*/ ctx[5];
    			if (dirty[0] & /*editapp*/ 4) textinput4_changes.disable = /*editapp*/ ctx[2];
    			textinput4.$set(textinput4_changes);
    			const textinput5_changes = {};
    			if (dirty[0] & /*grouplist*/ 1) textinput5_changes.grouplist = /*grouplist*/ ctx[0];
    			if (dirty[0] & /*permitcreate*/ 256) textinput5_changes.value = /*permitcreate*/ ctx[8];
    			textinput5.$set(textinput5_changes);
    			const textinput6_changes = {};
    			if (dirty[0] & /*grouplist*/ 1) textinput6_changes.grouplist = /*grouplist*/ ctx[0];
    			if (dirty[0] & /*permitopen*/ 2048) textinput6_changes.value = /*permitopen*/ ctx[11];
    			textinput6.$set(textinput6_changes);
    			const textinput7_changes = {};
    			if (dirty[0] & /*grouplist*/ 1) textinput7_changes.grouplist = /*grouplist*/ ctx[0];
    			if (dirty[0] & /*permittodo*/ 4096) textinput7_changes.value = /*permittodo*/ ctx[12];
    			textinput7.$set(textinput7_changes);
    			const textinput8_changes = {};
    			if (dirty[0] & /*grouplist*/ 1) textinput8_changes.grouplist = /*grouplist*/ ctx[0];
    			if (dirty[0] & /*permitdoing*/ 512) textinput8_changes.value = /*permitdoing*/ ctx[9];
    			textinput8.$set(textinput8_changes);
    			const textinput9_changes = {};
    			if (dirty[0] & /*grouplist*/ 1) textinput9_changes.grouplist = /*grouplist*/ ctx[0];
    			if (dirty[0] & /*permitdone*/ 1024) textinput9_changes.value = /*permitdone*/ ctx[10];
    			textinput9.$set(textinput9_changes);
    			const button_changes = {};

    			if (dirty[1] & /*$$scope*/ 4) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(textinput2.$$.fragment, local);
    			transition_in(textinput3.$$.fragment, local);
    			transition_in(textinput4.$$.fragment, local);
    			transition_in(textinput5.$$.fragment, local);
    			transition_in(textinput6.$$.fragment, local);
    			transition_in(textinput7.$$.fragment, local);
    			transition_in(textinput8.$$.fragment, local);
    			transition_in(textinput9.$$.fragment, local);
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(textinput2.$$.fragment, local);
    			transition_out(textinput3.$$.fragment, local);
    			transition_out(textinput4.$$.fragment, local);
    			transition_out(textinput5.$$.fragment, local);
    			transition_out(textinput6.$$.fragment, local);
    			transition_out(textinput7.$$.fragment, local);
    			transition_out(textinput8.$$.fragment, local);
    			transition_out(textinput9.$$.fragment, local);
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(form);
    			destroy_component(textinput0);
    			destroy_component(textinput1);
    			destroy_component(textinput2);
    			destroy_component(textinput3);
    			destroy_component(textinput4);
    			destroy_component(textinput5);
    			destroy_component(textinput6);
    			destroy_component(textinput7);
    			destroy_component(textinput8);
    			destroy_component(textinput9);
    			destroy_component(button);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment$m(ctx) {
    	let modal;
    	let current;

    	modal = new Modal({
    			props: {
    				title: /*editapp*/ ctx[2]
    				? `Edit ${/*appselected*/ ctx[1]}`
    				: "Create Application",
    				$$slots: { default: [create_default_slot$a] },
    				$$scope: { ctx }
    			}
    		});

    	modal.$on("close", /*close_handler*/ ctx[26]);
    	modal.$on("submit", /*submit_handler*/ ctx[27]);

    	return {
    		c() {
    			create_component(modal.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(modal.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(modal, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const modal_changes = {};

    			if (dirty[0] & /*editapp, appselected*/ 6) modal_changes.title = /*editapp*/ ctx[2]
    			? `Edit ${/*appselected*/ ctx[1]}`
    			: "Create Application";

    			if (dirty[0] & /*grouplist, permitdone, permitdoing, permittodo, permitopen, permitcreate, rnumber, editapp, enddate, startdate, description, appacronym*/ 8189 | dirty[1] & /*$$scope*/ 4) {
    				modal_changes.$$scope = { dirty, ctx };
    			}

    			modal.$set(modal_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(modal.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(modal.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(modal, detaching);
    		}
    	};
    }

    function instance$g($$self, $$props, $$invalidate) {
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
    	const dispatch = createEventDispatcher();

    	onMount(() => {
    		getAllGroups();

    		if (editapp) {
    			const app = appData.find(app => app.appacronym === appselected);
    			$$invalidate(3, appacronym = app.appacronym);
    			$$invalidate(4, description = app.description);
    			$$invalidate(5, rnumber = app.rnumber);
    			$$invalidate(6, startdate = app.startdate);
    			$$invalidate(7, enddate = app.enddate);
    			$$invalidate(8, permitcreate = app.permitcreate);
    			$$invalidate(9, permitdoing = app.permitdoing);
    			$$invalidate(10, permitdone = app.permitdone);
    			$$invalidate(11, permitopen = app.permitopen);
    			$$invalidate(12, permittodo = app.permittodo);
    		}
    	});

    	async function getAllGroups() {
    		const url = "http://localhost:8080/fetchgroups";

    		fetch(url).then(response => response.json()).then(data => {
    			const dataArr = data.map(grp => grp.groupname);
    			$$invalidate(0, grouplist = dataArr);
    		}).catch(error => {
    			console.log(error);
    		});
    	}

    	const createApp = () => {
    		const url = "http://localhost:8080/createapp";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				AppAcronym: appacronym,
    				Description: description,
    				Rnumber: rnumber,
    				StartDate: startdate,
    				EndDate: enddate,
    				PermitCreate: permitcreate,
    				PermitDoing: permitdoing,
    				PermitDone: permitdone,
    				PermitOpen: permitopen,
    				PermitToDo: permittodo,
    				Editor: sessionStorage.getItem("JWT"),
    				Group: "configmanager"
    			})
    		}).then(response => response.json()).then(data => {
    			if (data.Code != 200) {
    				alert(data.Message);
    			} else {
    				appcolorMethods.addAppColors(appacronym);
    				dispatch("update");
    				alert("Successfully created application");
    				emptyFields();
    			} // window.location.reload(false);
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const editApp = () => {
    		const url = "http://localhost:8080/editapp";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				AppAcronym: appacronym,
    				PermitCreate: permitcreate,
    				PermitDoing: permitdoing,
    				PermitDone: permitdone,
    				PermitOpen: permitopen,
    				PermitToDo: permittodo,
    				Editor: sessionStorage.getItem("JWT"),
    				Group: "configmanager"
    			})
    		}).then(response => response.json()).then(data => {
    			if (data.Code != 200) {
    				alert(data.Message);
    			} else {
    				dispatch("update");
    				alert("Application successfully updated");
    			}
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const submitHandler = () => {
    		if (appacronym == "") {
    			alert("App Acronym can't be empty");
    		} else if (plans.includes(appacronym)) {
    			alert("App name not allowed, please select a different app name");
    		} else if (appacronym == "allapps") {
    			alert("Please use another app name");
    		} else if (startdate == "") {
    			alert("Start date can't be empty");
    		} else if (startdate > enddate) {
    			alert("End date can't be empty");
    		} else if (startdate > enddate) {
    			alert("Start date cannot before before the End date");
    		} else if (rnumber == "") {
    			alert("App running number is required");
    		} else {
    			editapp ? editApp() : createApp();
    		}
    	};

    	const emptyFields = () => {
    		$$invalidate(3, appacronym = "");
    		$$invalidate(4, description = "");
    		$$invalidate(5, rnumber = "");
    		$$invalidate(6, startdate = "");
    		$$invalidate(7, enddate = "");
    		$$invalidate(8, permitcreate = "");
    		$$invalidate(9, permitdoing = "");
    		$$invalidate(10, permitdone = "");
    		$$invalidate(11, permitopen = "");
    		$$invalidate(12, permittodo = "");
    	};

    	const input_handler = e => $$invalidate(3, appacronym = e.target.value);
    	const input_handler_1 = e => $$invalidate(4, description = e.target.value);
    	const input_handler_2 = e => $$invalidate(6, startdate = e.target.value);
    	const input_handler_3 = e => $$invalidate(7, enddate = e.target.value);
    	const input_handler_4 = e => $$invalidate(5, rnumber = e.target.value);
    	const input_handler_5 = e => $$invalidate(8, permitcreate = e.target.value);
    	const input_handler_6 = e => $$invalidate(11, permitopen = e.target.value);
    	const input_handler_7 = e => $$invalidate(12, permittodo = e.target.value);
    	const input_handler_8 = e => $$invalidate(9, permitdoing = e.target.value);
    	const input_handler_9 = e => $$invalidate(10, permitdone = e.target.value);

    	function close_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function submit_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('grouplist' in $$props) $$invalidate(0, grouplist = $$props.grouplist);
    		if ('appselected' in $$props) $$invalidate(1, appselected = $$props.appselected);
    		if ('appData' in $$props) $$invalidate(14, appData = $$props.appData);
    		if ('editapp' in $$props) $$invalidate(2, editapp = $$props.editapp);
    		if ('plans' in $$props) $$invalidate(15, plans = $$props.plans);
    	};

    	return [
    		grouplist,
    		appselected,
    		editapp,
    		appacronym,
    		description,
    		rnumber,
    		startdate,
    		enddate,
    		permitcreate,
    		permitdoing,
    		permitdone,
    		permitopen,
    		permittodo,
    		submitHandler,
    		appData,
    		plans,
    		input_handler,
    		input_handler_1,
    		input_handler_2,
    		input_handler_3,
    		input_handler_4,
    		input_handler_5,
    		input_handler_6,
    		input_handler_7,
    		input_handler_8,
    		input_handler_9,
    		close_handler,
    		submit_handler
    	];
    }

    class AppForm extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(
    			this,
    			options,
    			instance$g,
    			create_fragment$m,
    			safe_not_equal,
    			{
    				grouplist: 0,
    				appselected: 1,
    				appData: 14,
    				editapp: 2,
    				plans: 15
    			},
    			null,
    			[-1, -1]
    		);
    	}
    }

    /* src\components\TaskForma.svelte generated by Svelte v3.50.1 */

    function create_default_slot_1$6(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Submit");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Submit");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (65:0) <Modal title="Create task" on:close>
    function create_default_slot$9(ctx) {
    	let form;
    	let textinput0;
    	let t0;
    	let textinput1;
    	let t1;
    	let textinput2;
    	let t2;
    	let div1;
    	let div0;
    	let t3;
    	let button;
    	let current;
    	let mounted;
    	let dispose;

    	textinput0 = new TextInput({
    			props: {
    				id: "name",
    				type: "text",
    				label: "Task Name: ",
    				placeholder: "Enter task name",
    				value: /*taskname*/ ctx[1]
    			}
    		});

    	textinput0.$on("input", /*input_handler*/ ctx[6]);

    	textinput1 = new TextInput({
    			props: {
    				controlType: "textarea",
    				id: "description",
    				label: "Task Description",
    				rows: "3",
    				resize: true,
    				placeholder: "Enter task description",
    				value: /*taskdes*/ ctx[2]
    			}
    		});

    	textinput1.$on("input", /*input_handler_1*/ ctx[7]);

    	textinput2 = new TextInput({
    			props: {
    				controlType: "textarea",
    				id: "notes",
    				label: "Notes",
    				placeholder: "Enter task notes",
    				resize: true,
    				rows: "3",
    				value: /*notes*/ ctx[0]
    			}
    		});

    	textinput2.$on("input", /*input_handler_2*/ ctx[8]);

    	button = new Button({
    			props: {
    				type: "submit",
    				mode: "outline",
    				$$slots: { default: [create_default_slot_1$6] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			form = element("form");
    			create_component(textinput0.$$.fragment);
    			t0 = space();
    			create_component(textinput1.$$.fragment);
    			t1 = space();
    			create_component(textinput2.$$.fragment);
    			t2 = space();
    			div1 = element("div");
    			div0 = element("div");
    			t3 = space();
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			form = claim_element(nodes, "FORM", { class: true });
    			var form_nodes = children(form);
    			claim_component(textinput0.$$.fragment, form_nodes);
    			t0 = claim_space(form_nodes);
    			claim_component(textinput1.$$.fragment, form_nodes);
    			t1 = claim_space(form_nodes);
    			claim_component(textinput2.$$.fragment, form_nodes);
    			t2 = claim_space(form_nodes);
    			div1 = claim_element(form_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			div0 = claim_element(div1_nodes, "DIV", {});
    			children(div0).forEach(detach);
    			t3 = claim_space(div1_nodes);
    			claim_component(button.$$.fragment, div1_nodes);
    			div1_nodes.forEach(detach);
    			form_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div1, "class", "btn-container svelte-1h13ssy");
    			attr(form, "class", "task-form svelte-1h13ssy");
    		},
    		m(target, anchor) {
    			insert_hydration(target, form, anchor);
    			mount_component(textinput0, form, null);
    			append_hydration(form, t0);
    			mount_component(textinput1, form, null);
    			append_hydration(form, t1);
    			mount_component(textinput2, form, null);
    			append_hydration(form, t2);
    			append_hydration(form, div1);
    			append_hydration(div1, div0);
    			append_hydration(div1, t3);
    			mount_component(button, div1, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(form, "submit", prevent_default(/*createTask*/ ctx[3]));
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			const textinput0_changes = {};
    			if (dirty & /*taskname*/ 2) textinput0_changes.value = /*taskname*/ ctx[1];
    			textinput0.$set(textinput0_changes);
    			const textinput1_changes = {};
    			if (dirty & /*taskdes*/ 4) textinput1_changes.value = /*taskdes*/ ctx[2];
    			textinput1.$set(textinput1_changes);
    			const textinput2_changes = {};
    			if (dirty & /*notes*/ 1) textinput2_changes.value = /*notes*/ ctx[0];
    			textinput2.$set(textinput2_changes);
    			const button_changes = {};

    			if (dirty & /*$$scope*/ 16384) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(textinput2.$$.fragment, local);
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(textinput2.$$.fragment, local);
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(form);
    			destroy_component(textinput0);
    			destroy_component(textinput1);
    			destroy_component(textinput2);
    			destroy_component(button);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment$l(ctx) {
    	let modal;
    	let current;

    	modal = new Modal({
    			props: {
    				title: "Create task",
    				$$slots: { default: [create_default_slot$9] },
    				$$scope: { ctx }
    			}
    		});

    	modal.$on("close", /*close_handler*/ ctx[9]);

    	return {
    		c() {
    			create_component(modal.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(modal.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(modal, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const modal_changes = {};

    			if (dirty & /*$$scope, notes, taskdes, taskname*/ 16391) {
    				modal_changes.$$scope = { dirty, ctx };
    			}

    			modal.$set(modal_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(modal.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(modal.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(modal, detaching);
    		}
    	};
    }

    function instance$f($$self, $$props, $$invalidate) {
    	let $applicationMethods;
    	component_subscribe($$self, applicationMethods, $$value => $$invalidate(10, $applicationMethods = $$value));
    	const dispatch = createEventDispatcher();
    	let { appselected } = $$props;
    	let { state } = $$props;

    	let group = state === undefined
    	? ""
    	: $applicationMethods.filter(e => e.appname === appselected)[0][state];

    	let notes = "";
    	let taskname = "";
    	let taskdes = "";

    	const emptyFields = () => {
    		$$invalidate(0, notes = "");
    		$$invalidate(1, taskname = "");
    		$$invalidate(2, taskdes = "");
    	};

    	const createTask = () => {
    		if (taskname == "") {
    			alert("Task name can't be empty");
    			return;
    		}

    		// let valueone = `Add Note...`;
    		// let taskselected = "";
    		// let tasknames = ["QW","DS","FD"];
    		// const createTask = (e) => {
    		// e.preventDefault();
    		// console.log(rnumber);
    		const url = "http://localhost:8080/createtask";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				taskname,
    				taskdes,
    				addedtasknote: notes,
    				taskacronym: appselected,
    				editor: sessionStorage.getItem("JWT"),
    				group
    			})
    		}).then(response => response.json()).then(data => {
    			if (data.code != 200) {
    				alert(data.Message);
    			} else {
    				alert("Task successfully added.");
    			}

    			dispatch("update");
    			emptyFields();
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const input_handler = e => $$invalidate(1, taskname = e.target.value);
    	const input_handler_1 = e => $$invalidate(2, taskdes = e.target.value);
    	const input_handler_2 = e => $$invalidate(0, notes = e.target.value);

    	function close_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('appselected' in $$props) $$invalidate(4, appselected = $$props.appselected);
    		if ('state' in $$props) $$invalidate(5, state = $$props.state);
    	};

    	return [
    		notes,
    		taskname,
    		taskdes,
    		createTask,
    		appselected,
    		state,
    		input_handler,
    		input_handler_1,
    		input_handler_2,
    		close_handler
    	];
    }

    class TaskForma$1 extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$f, create_fragment$l, safe_not_equal, { appselected: 4, state: 5 });
    	}
    }

    /* src\UI\ScrollingList.svelte generated by Svelte v3.50.1 */

    function get_each_context$4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[7] = list[i];
    	return child_ctx;
    }

    // (61:2) {#each arr as a (a)}
    function create_each_block$4(key_1, ctx) {
    	let ul;
    	let div;
    	let li;
    	let t0_value = /*a*/ ctx[7] + "";
    	let t0;
    	let t1;
    	let span;
    	let span_style_value;
    	let li_id_value;
    	let t2;
    	let mounted;
    	let dispose;

    	return {
    		key: key_1,
    		first: null,
    		c() {
    			ul = element("ul");
    			div = element("div");
    			li = element("li");
    			t0 = text(t0_value);
    			t1 = space();
    			span = element("span");
    			t2 = space();
    			this.h();
    		},
    		l(nodes) {
    			ul = claim_element(nodes, "UL", {});
    			var ul_nodes = children(ul);
    			div = claim_element(ul_nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			li = claim_element(div_nodes, "LI", { class: true, id: true });
    			var li_nodes = children(li);
    			t0 = claim_text(li_nodes, t0_value);
    			t1 = claim_space(li_nodes);
    			span = claim_element(li_nodes, "SPAN", { class: true, style: true });
    			var span_nodes = children(span);
    			span_nodes.forEach(detach);
    			li_nodes.forEach(detach);
    			div_nodes.forEach(detach);
    			t2 = claim_space(ul_nodes);
    			ul_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(span, "class", "legend svelte-1274acw");

    			attr(span, "style", span_style_value = "background-color: " + (/*type*/ ctx[1] == "application"
    			? /*$appcolorMethods*/ ctx[2].appColors[/*a*/ ctx[7]]
    			: /*type*/ ctx[1] == "plan"
    				? /*$appcolorMethods*/ ctx[2].planColors[/*a*/ ctx[7]]
    				: "") + "; " + (/*type*/ ctx[1] == "plan" ? "border-radius: 25px;" : "") + ";");

    			attr(li, "class", "legend-container svelte-1274acw");
    			attr(li, "id", li_id_value = /*a*/ ctx[7]);
    			attr(div, "class", "list-item svelte-1274acw");
    			this.first = ul;
    		},
    		m(target, anchor) {
    			insert_hydration(target, ul, anchor);
    			append_hydration(ul, div);
    			append_hydration(div, li);
    			append_hydration(li, t0);
    			append_hydration(li, t1);
    			append_hydration(li, span);
    			append_hydration(ul, t2);

    			if (!mounted) {
    				dispose = listen(li, "click", function () {
    					if (is_function(/*activateHighlight*/ ctx[3](/*a*/ ctx[7], /*type*/ ctx[1]))) /*activateHighlight*/ ctx[3](/*a*/ ctx[7], /*type*/ ctx[1]).apply(this, arguments);
    				});

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*arr*/ 1 && t0_value !== (t0_value = /*a*/ ctx[7] + "")) set_data(t0, t0_value);

    			if (dirty & /*type, $appcolorMethods, arr*/ 7 && span_style_value !== (span_style_value = "background-color: " + (/*type*/ ctx[1] == "application"
    			? /*$appcolorMethods*/ ctx[2].appColors[/*a*/ ctx[7]]
    			: /*type*/ ctx[1] == "plan"
    				? /*$appcolorMethods*/ ctx[2].planColors[/*a*/ ctx[7]]
    				: "") + "; " + (/*type*/ ctx[1] == "plan" ? "border-radius: 25px;" : "") + ";")) {
    				attr(span, "style", span_style_value);
    			}

    			if (dirty & /*arr*/ 1 && li_id_value !== (li_id_value = /*a*/ ctx[7])) {
    				attr(li, "id", li_id_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(ul);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment$k(ctx) {
    	let div;
    	let each_blocks = [];
    	let each_1_lookup = new Map();
    	let each_value = /*arr*/ ctx[0];
    	const get_key = ctx => /*a*/ ctx[7];

    	for (let i = 0; i < each_value.length; i += 1) {
    		let child_ctx = get_each_context$4(ctx, each_value, i);
    		let key = get_key(child_ctx);
    		each_1_lookup.set(key, each_blocks[i] = create_each_block$4(key, child_ctx));
    	}

    	return {
    		c() {
    			div = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(div_nodes);
    			}

    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "list svelte-1274acw");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div, null);
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*arr, activateHighlight, type, $appcolorMethods*/ 15) {
    				each_value = /*arr*/ ctx[0];
    				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, div, destroy_block, create_each_block$4, null, get_each_context$4);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].d();
    			}
    		}
    	};
    }

    function instance$e($$self, $$props, $$invalidate) {
    	let $appcolorMethods;
    	component_subscribe($$self, appcolorMethods, $$value => $$invalidate(2, $appcolorMethods = $$value));
    	let { arr } = $$props;
    	let { type } = $$props;
    	let { appselected } = $$props;
    	let { planselected } = $$props;
    	const dispatch = createEventDispatcher();

    	const activateHighlight = (id, type) => {
    		if (type === "application") {
    			for (var i = 0; i < arr.length; i++) {
    				document.getElementById(arr[i]).style.color = "black";
    				document.getElementById(arr[i]).style.backgroundColor = "white";
    			}

    			document.getElementById(id).style.color = "red";
    			document.getElementById(id).style.backgroundColor = "rgba(208, 208, 68, 0.232)";

    			if (planselected !== "allplans" && appselected !== "allapps") {
    				document.getElementById("allplans").style.color = "red";
    				document.getElementById("allplans").style.backgroundColor = "rgba(208, 208, 68, 0.232)";
    				document.getElementById(planselected).style.color = "black";
    				document.getElementById(planselected).style.backgroundColor = "white";
    			}
    		}

    		if (type === "plan") {
    			// switch all plan selection to black except for the selected plan
    			for (var i = 0; i < arr.length; i++) {
    				document.getElementById(arr[i]).style.color = "black";
    				document.getElementById(arr[i]).style.backgroundColor = "white";
    			}

    			document.getElementById(id).style.color = "red";
    			document.getElementById(id).style.backgroundColor = "rgba(208, 208, 68, 0.232)";

    			if (appselected === "allapps") {
    				document.getElementById("allplans").style.color = "red";
    				document.getElementById("allplans").style.backgroundColor = "rgba(208, 208, 68, 0.232)";
    			}

    			if (planselected !== "allplans") {
    				document.getElementById("allplans").style.color = "black";
    				document.getElementById("allplans").style.backgroundColor = "white";
    			}

    			if (id === "allplans") {
    				document.getElementById("allplans").style.color = "red";
    				document.getElementById("allplans").style.backgroundColor = "rgba(208, 208, 68, 0.232)";
    			}
    		}

    		dispatch("selected", id);
    	};

    	$$self.$$set = $$props => {
    		if ('arr' in $$props) $$invalidate(0, arr = $$props.arr);
    		if ('type' in $$props) $$invalidate(1, type = $$props.type);
    		if ('appselected' in $$props) $$invalidate(4, appselected = $$props.appselected);
    		if ('planselected' in $$props) $$invalidate(5, planselected = $$props.planselected);
    	};

    	return [arr, type, $appcolorMethods, activateHighlight, appselected, planselected];
    }

    class ScrollingList extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$e, create_fragment$k, safe_not_equal, {
    			arr: 0,
    			type: 1,
    			appselected: 4,
    			planselected: 5
    		});
    	}
    }

    /* src\components\DashboardContent.svelte generated by Svelte v3.50.1 */

    function get_each_context$3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[39] = list[i];
    	return child_ctx;
    }

    function get_each_context_1$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[39] = list[i];
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[39] = list[i];
    	return child_ctx;
    }

    function get_each_context_3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[39] = list[i];
    	return child_ctx;
    }

    function get_each_context_4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[39] = list[i];
    	return child_ctx;
    }

    // (347:8) {#if showcreateappB}
    function create_if_block_12(ctx) {
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				id: "newapp",
    				size: "sm",
    				mode: "outline",
    				$$slots: { default: [create_default_slot_3] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*toggleAppForm*/ ctx[18]);

    	return {
    		c() {
    			create_component(button.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(button.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(button, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty[1] & /*$$scope*/ 524288) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(button, detaching);
    		}
    	};
    }

    // (348:10) <Button id="newapp" size="sm" mode="outline" on:click={toggleAppForm}              >
    function create_default_slot_3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("New App");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "New App");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (352:8) {#if showcreateappB && appselected !== "allapps"}
    function create_if_block_11(ctx) {
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				id: "editapp",
    				size: "sm",
    				mode: "outline",
    				$$slots: { default: [create_default_slot_2$2] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*toggleAppForm*/ ctx[18]);

    	return {
    		c() {
    			create_component(button.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(button.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(button, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty[1] & /*$$scope*/ 524288) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(button, detaching);
    		}
    	};
    }

    // (353:10) <Button id="editapp" size="sm" mode="outline" on:click={toggleAppForm}              >
    function create_default_slot_2$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Edit App");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Edit App");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (366:4) {#if appselected != "allapps"}
    function create_if_block_9$1(ctx) {
    	let div;
    	let p;
    	let t0;
    	let t1;
    	let t2;
    	let scrollinglist;
    	let current;
    	let if_block = /*showcreateplanB*/ ctx[1] && create_if_block_10(ctx);

    	scrollinglist = new ScrollingList({
    			props: {
    				arr: ["allplans", .../*filteredplans*/ ctx[7]],
    				type: "plan"
    			}
    		});

    	scrollinglist.$on("selected", /*filterTaskByAppPlan*/ ctx[21]);

    	return {
    		c() {
    			div = element("div");
    			p = element("p");
    			t0 = text("Plans");
    			t1 = space();
    			if (if_block) if_block.c();
    			t2 = space();
    			create_component(scrollinglist.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			p = claim_element(div_nodes, "P", { class: true });
    			var p_nodes = children(p);
    			t0 = claim_text(p_nodes, "Plans");
    			p_nodes.forEach(detach);
    			t1 = claim_space(div_nodes);
    			if (if_block) if_block.l(div_nodes);
    			t2 = claim_space(div_nodes);
    			claim_component(scrollinglist.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(p, "class", "svelte-w8pctw");
    			attr(div, "class", "left-section svelte-w8pctw");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			append_hydration(div, p);
    			append_hydration(p, t0);
    			append_hydration(div, t1);
    			if (if_block) if_block.m(div, null);
    			append_hydration(div, t2);
    			mount_component(scrollinglist, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*showcreateplanB*/ ctx[1]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty[0] & /*showcreateplanB*/ 2) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_10(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, t2);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}

    			const scrollinglist_changes = {};
    			if (dirty[0] & /*filteredplans*/ 128) scrollinglist_changes.arr = ["allplans", .../*filteredplans*/ ctx[7]];
    			scrollinglist.$set(scrollinglist_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			transition_in(scrollinglist.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			transition_out(scrollinglist.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			destroy_component(scrollinglist);
    		}
    	};
    }

    // (370:8) {#if showcreateplanB}
    function create_if_block_10(ctx) {
    	let div;
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				size: "sm",
    				mode: "outline",
    				$$slots: { default: [create_default_slot_1$5] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*showCreatePlan*/ ctx[15]);

    	return {
    		c() {
    			div = element("div");
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			claim_component(button.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "button-center svelte-w8pctw");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			mount_component(button, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty[1] & /*$$scope*/ 524288) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(button);
    		}
    	};
    }

    // (372:12) <Button size="sm" mode="outline" on:click={showCreatePlan}>
    function create_default_slot_1$5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("New Plan");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "New Plan");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (387:2) {#if appForm}
    function create_if_block_8$1(ctx) {
    	let appform;
    	let current;

    	appform = new AppForm({
    			props: {
    				plans: ["allplans", .../*plans*/ ctx[6]],
    				appselected: /*appselected*/ ctx[8],
    				appData: /*appData*/ ctx[4],
    				editapp: /*editapp*/ ctx[13]
    			}
    		});

    	appform.$on("update", /*updateApp*/ ctx[22]);
    	appform.$on("close", /*toggleAppForm*/ ctx[18]);

    	return {
    		c() {
    			create_component(appform.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(appform.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(appform, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const appform_changes = {};
    			if (dirty[0] & /*plans*/ 64) appform_changes.plans = ["allplans", .../*plans*/ ctx[6]];
    			if (dirty[0] & /*appselected*/ 256) appform_changes.appselected = /*appselected*/ ctx[8];
    			if (dirty[0] & /*appData*/ 16) appform_changes.appData = /*appData*/ ctx[4];
    			if (dirty[0] & /*editapp*/ 8192) appform_changes.editapp = /*editapp*/ ctx[13];
    			appform.$set(appform_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(appform.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(appform.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(appform, detaching);
    		}
    	};
    }

    // (391:2) {#if taskForm}
    function create_if_block_7$1(ctx) {
    	let taskforma;
    	let current;

    	taskforma = new TaskForma$1({
    			props: {
    				state: "permitCreate",
    				appselected: /*appselected*/ ctx[8]
    			}
    		});

    	taskforma.$on("update", /*getAllUpdatedTask*/ ctx[17]);
    	taskforma.$on("close", /*toggleTaskForm*/ ctx[19]);

    	return {
    		c() {
    			create_component(taskforma.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(taskforma.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(taskforma, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const taskforma_changes = {};
    			if (dirty[0] & /*appselected*/ 256) taskforma_changes.appselected = /*appselected*/ ctx[8];
    			taskforma.$set(taskforma_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(taskforma.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(taskforma.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(taskforma, detaching);
    		}
    	};
    }

    // (395:2) {#if createPlan}
    function create_if_block_6$1(ctx) {
    	let createplan;
    	let current;

    	createplan = new CreatePlan({
    			props: {
    				apps: ["allapps", .../*apps*/ ctx[5]],
    				appselected: /*appselected*/ ctx[8]
    			}
    		});

    	createplan.$on("update", /*update_handler*/ ctx[23]);
    	createplan.$on("close", /*closeCreatePlan*/ ctx[16]);

    	return {
    		c() {
    			create_component(createplan.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(createplan.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(createplan, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const createplan_changes = {};
    			if (dirty[0] & /*apps*/ 32) createplan_changes.apps = ["allapps", .../*apps*/ ctx[5]];
    			if (dirty[0] & /*appselected*/ 256) createplan_changes.appselected = /*appselected*/ ctx[8];
    			createplan.$set(createplan_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(createplan.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(createplan.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(createplan, detaching);
    		}
    	};
    }

    // (404:6) {#if showcreatetaskB && appselected !== "allapps"}
    function create_if_block_5$1(ctx) {
    	let div;
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				$$slots: { default: [create_default_slot$8] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*toggleTaskForm*/ ctx[19]);

    	return {
    		c() {
    			div = element("div");
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			claim_component(button.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "button-task svelte-w8pctw");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			mount_component(button, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty[1] & /*$$scope*/ 524288) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(button);
    		}
    	};
    }

    // (406:8) <Button on:click={toggleTaskForm}>
    function create_default_slot$8(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Create Task");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Create Task");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (411:8) {#if t.taskstate == "open"}
    function create_if_block_4$1(ctx) {
    	let task;
    	let current;

    	task = new Task({
    			props: {
    				key: /*t*/ ctx[39].taskid,
    				filteredplans: /*filteredplans*/ ctx[7],
    				state: "permitOpen",
    				task: /*t*/ ctx[39],
    				stateColor: openColor
    			}
    		});

    	task.$on("update", /*getAllUpdatedTask*/ ctx[17]);

    	return {
    		c() {
    			create_component(task.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(task.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(task, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const task_changes = {};
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.key = /*t*/ ctx[39].taskid;
    			if (dirty[0] & /*filteredplans*/ 128) task_changes.filteredplans = /*filteredplans*/ ctx[7];
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.task = /*t*/ ctx[39];
    			task.$set(task_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(task.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(task.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(task, detaching);
    		}
    	};
    }

    // (410:6) {#each filteredtask as t}
    function create_each_block_4(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*t*/ ctx[39].taskstate == "open" && create_if_block_4$1(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*t*/ ctx[39].taskstate == "open") {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty[0] & /*filteredtask*/ 8) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_4$1(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (431:8) {#if t.taskstate == "todo"}
    function create_if_block_3$1(ctx) {
    	let task;
    	let current;

    	task = new Task({
    			props: {
    				key: /*t*/ ctx[39].taskid,
    				filteredplans: /*filteredplans*/ ctx[7],
    				state: "permitTodo",
    				task: /*t*/ ctx[39],
    				stateColor: todoColor
    			}
    		});

    	task.$on("update", /*getAllUpdatedTask*/ ctx[17]);

    	return {
    		c() {
    			create_component(task.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(task.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(task, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const task_changes = {};
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.key = /*t*/ ctx[39].taskid;
    			if (dirty[0] & /*filteredplans*/ 128) task_changes.filteredplans = /*filteredplans*/ ctx[7];
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.task = /*t*/ ctx[39];
    			task.$set(task_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(task.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(task.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(task, detaching);
    		}
    	};
    }

    // (430:6) {#each filteredtask as t}
    function create_each_block_3(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*t*/ ctx[39].taskstate == "todo" && create_if_block_3$1(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*t*/ ctx[39].taskstate == "todo") {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty[0] & /*filteredtask*/ 8) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_3$1(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (451:8) {#if t.taskstate == "doing"}
    function create_if_block_2$2(ctx) {
    	let task;
    	let current;

    	task = new Task({
    			props: {
    				key: /*t*/ ctx[39].taskid,
    				filteredplans: /*filteredplans*/ ctx[7],
    				state: "permitDoing",
    				task: /*t*/ ctx[39],
    				stateColor: doingColor
    			}
    		});

    	task.$on("update", /*getAllUpdatedTask*/ ctx[17]);

    	return {
    		c() {
    			create_component(task.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(task.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(task, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const task_changes = {};
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.key = /*t*/ ctx[39].taskid;
    			if (dirty[0] & /*filteredplans*/ 128) task_changes.filteredplans = /*filteredplans*/ ctx[7];
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.task = /*t*/ ctx[39];
    			task.$set(task_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(task.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(task.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(task, detaching);
    		}
    	};
    }

    // (450:6) {#each filteredtask as t}
    function create_each_block_2(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*t*/ ctx[39].taskstate == "doing" && create_if_block_2$2(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*t*/ ctx[39].taskstate == "doing") {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty[0] & /*filteredtask*/ 8) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_2$2(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (471:8) {#if t.taskstate == "done"}
    function create_if_block_1$2(ctx) {
    	let task;
    	let current;

    	task = new Task({
    			props: {
    				key: /*t*/ ctx[39].taskid,
    				filteredplans: /*filteredplans*/ ctx[7],
    				state: "permitDone",
    				task: /*t*/ ctx[39],
    				stateColor: doneColor
    			}
    		});

    	task.$on("update", /*getAllUpdatedTask*/ ctx[17]);

    	return {
    		c() {
    			create_component(task.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(task.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(task, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const task_changes = {};
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.key = /*t*/ ctx[39].taskid;
    			if (dirty[0] & /*filteredplans*/ 128) task_changes.filteredplans = /*filteredplans*/ ctx[7];
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.task = /*t*/ ctx[39];
    			task.$set(task_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(task.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(task.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(task, detaching);
    		}
    	};
    }

    // (470:6) {#each filteredtask as t}
    function create_each_block_1$1(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*t*/ ctx[39].taskstate == "done" && create_if_block_1$2(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*t*/ ctx[39].taskstate == "done") {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty[0] & /*filteredtask*/ 8) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_1$2(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (491:8) {#if t.taskstate == "closed"}
    function create_if_block$3(ctx) {
    	let task;
    	let current;

    	task = new Task({
    			props: {
    				key: /*t*/ ctx[39].taskid,
    				filteredplans: /*filteredplans*/ ctx[7],
    				task: /*t*/ ctx[39],
    				stateColor: closeColor
    			}
    		});

    	task.$on("update", /*getAllUpdatedTask*/ ctx[17]);

    	return {
    		c() {
    			create_component(task.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(task.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(task, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const task_changes = {};
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.key = /*t*/ ctx[39].taskid;
    			if (dirty[0] & /*filteredplans*/ 128) task_changes.filteredplans = /*filteredplans*/ ctx[7];
    			if (dirty[0] & /*filteredtask*/ 8) task_changes.task = /*t*/ ctx[39];
    			task.$set(task_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(task.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(task.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(task, detaching);
    		}
    	};
    }

    // (490:6) {#each filteredtask as t}
    function create_each_block$3(ctx) {
    	let if_block_anchor;
    	let current;
    	let if_block = /*t*/ ctx[39].taskstate == "closed" && create_if_block$3(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*t*/ ctx[39].taskstate == "closed") {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty[0] & /*filteredtask*/ 8) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block$3(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function create_fragment$j(ctx) {
    	let main;
    	let div2;
    	let div1;
    	let p0;
    	let t0;
    	let t1;
    	let div0;
    	let t2;
    	let t3;
    	let scrollinglist;
    	let t4;
    	let t5;
    	let t6;
    	let t7;
    	let t8;
    	let div18;
    	let div5;
    	let div3;
    	let p1;
    	let t9;
    	let t10;
    	let t11;
    	let div4;
    	let t12;
    	let div8;
    	let div6;
    	let p2;
    	let t13;
    	let t14;
    	let div7;
    	let t15;
    	let div11;
    	let div9;
    	let p3;
    	let t16;
    	let t17;
    	let div10;
    	let t18;
    	let div14;
    	let div12;
    	let p4;
    	let t19;
    	let t20;
    	let div13;
    	let t21;
    	let div17;
    	let div15;
    	let p5;
    	let t22;
    	let t23;
    	let div16;
    	let current;
    	let if_block0 = /*showcreateappB*/ ctx[2] && create_if_block_12(ctx);
    	let if_block1 = /*showcreateappB*/ ctx[2] && /*appselected*/ ctx[8] !== "allapps" && create_if_block_11(ctx);

    	scrollinglist = new ScrollingList({
    			props: {
    				arr: ["allapps", .../*apps*/ ctx[5]],
    				type: "application",
    				appselected: /*appselected*/ ctx[8],
    				planselected: /*planselected*/ ctx[9]
    			}
    		});

    	scrollinglist.$on("selected", /*filterTaskByApp*/ ctx[20]);
    	let if_block2 = /*appselected*/ ctx[8] != "allapps" && create_if_block_9$1(ctx);
    	let if_block3 = /*appForm*/ ctx[11] && create_if_block_8$1(ctx);
    	let if_block4 = /*taskForm*/ ctx[12] && create_if_block_7$1(ctx);
    	let if_block5 = /*createPlan*/ ctx[10] && create_if_block_6$1(ctx);
    	let if_block6 = /*showcreatetaskB*/ ctx[0] && /*appselected*/ ctx[8] !== "allapps" && create_if_block_5$1(ctx);
    	let each_value_4 = /*filteredtask*/ ctx[3];
    	let each_blocks_4 = [];

    	for (let i = 0; i < each_value_4.length; i += 1) {
    		each_blocks_4[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
    	}

    	const out = i => transition_out(each_blocks_4[i], 1, 1, () => {
    		each_blocks_4[i] = null;
    	});

    	let each_value_3 = /*filteredtask*/ ctx[3];
    	let each_blocks_3 = [];

    	for (let i = 0; i < each_value_3.length; i += 1) {
    		each_blocks_3[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
    	}

    	const out_1 = i => transition_out(each_blocks_3[i], 1, 1, () => {
    		each_blocks_3[i] = null;
    	});

    	let each_value_2 = /*filteredtask*/ ctx[3];
    	let each_blocks_2 = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks_2[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	const out_2 = i => transition_out(each_blocks_2[i], 1, 1, () => {
    		each_blocks_2[i] = null;
    	});

    	let each_value_1 = /*filteredtask*/ ctx[3];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1$1(get_each_context_1$1(ctx, each_value_1, i));
    	}

    	const out_3 = i => transition_out(each_blocks_1[i], 1, 1, () => {
    		each_blocks_1[i] = null;
    	});

    	let each_value = /*filteredtask*/ ctx[3];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$3(get_each_context$3(ctx, each_value, i));
    	}

    	const out_4 = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	return {
    		c() {
    			main = element("main");
    			div2 = element("div");
    			div1 = element("div");
    			p0 = element("p");
    			t0 = text("Applications");
    			t1 = space();
    			div0 = element("div");
    			if (if_block0) if_block0.c();
    			t2 = space();
    			if (if_block1) if_block1.c();
    			t3 = space();
    			create_component(scrollinglist.$$.fragment);
    			t4 = space();
    			if (if_block2) if_block2.c();
    			t5 = space();
    			if (if_block3) if_block3.c();
    			t6 = space();
    			if (if_block4) if_block4.c();
    			t7 = space();
    			if (if_block5) if_block5.c();
    			t8 = space();
    			div18 = element("div");
    			div5 = element("div");
    			div3 = element("div");
    			p1 = element("p");
    			t9 = text("Open");
    			t10 = space();
    			if (if_block6) if_block6.c();
    			t11 = space();
    			div4 = element("div");

    			for (let i = 0; i < each_blocks_4.length; i += 1) {
    				each_blocks_4[i].c();
    			}

    			t12 = space();
    			div8 = element("div");
    			div6 = element("div");
    			p2 = element("p");
    			t13 = text("To Do");
    			t14 = space();
    			div7 = element("div");

    			for (let i = 0; i < each_blocks_3.length; i += 1) {
    				each_blocks_3[i].c();
    			}

    			t15 = space();
    			div11 = element("div");
    			div9 = element("div");
    			p3 = element("p");
    			t16 = text("Doing");
    			t17 = space();
    			div10 = element("div");

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				each_blocks_2[i].c();
    			}

    			t18 = space();
    			div14 = element("div");
    			div12 = element("div");
    			p4 = element("p");
    			t19 = text("Done");
    			t20 = space();
    			div13 = element("div");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t21 = space();
    			div17 = element("div");
    			div15 = element("div");
    			p5 = element("p");
    			t22 = text("Close");
    			t23 = space();
    			div16 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.h();
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", { class: true });
    			var main_nodes = children(main);
    			div2 = claim_element(main_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			div1 = claim_element(div2_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			p0 = claim_element(div1_nodes, "P", { class: true });
    			var p0_nodes = children(p0);
    			t0 = claim_text(p0_nodes, "Applications");
    			p0_nodes.forEach(detach);
    			t1 = claim_space(div1_nodes);
    			div0 = claim_element(div1_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			if (if_block0) if_block0.l(div0_nodes);
    			t2 = claim_space(div0_nodes);
    			if (if_block1) if_block1.l(div0_nodes);
    			div0_nodes.forEach(detach);
    			t3 = claim_space(div1_nodes);
    			claim_component(scrollinglist.$$.fragment, div1_nodes);
    			div1_nodes.forEach(detach);
    			t4 = claim_space(div2_nodes);
    			if (if_block2) if_block2.l(div2_nodes);
    			div2_nodes.forEach(detach);
    			t5 = claim_space(main_nodes);
    			if (if_block3) if_block3.l(main_nodes);
    			t6 = claim_space(main_nodes);
    			if (if_block4) if_block4.l(main_nodes);
    			t7 = claim_space(main_nodes);
    			if (if_block5) if_block5.l(main_nodes);
    			t8 = claim_space(main_nodes);
    			div18 = claim_element(main_nodes, "DIV", { class: true });
    			var div18_nodes = children(div18);
    			div5 = claim_element(div18_nodes, "DIV", { class: true });
    			var div5_nodes = children(div5);
    			div3 = claim_element(div5_nodes, "DIV", { class: true, style: true });
    			var div3_nodes = children(div3);
    			p1 = claim_element(div3_nodes, "P", { class: true });
    			var p1_nodes = children(p1);
    			t9 = claim_text(p1_nodes, "Open");
    			p1_nodes.forEach(detach);
    			div3_nodes.forEach(detach);
    			t10 = claim_space(div5_nodes);
    			if (if_block6) if_block6.l(div5_nodes);
    			t11 = claim_space(div5_nodes);
    			div4 = claim_element(div5_nodes, "DIV", { class: true });
    			var div4_nodes = children(div4);

    			for (let i = 0; i < each_blocks_4.length; i += 1) {
    				each_blocks_4[i].l(div4_nodes);
    			}

    			div4_nodes.forEach(detach);
    			div5_nodes.forEach(detach);
    			t12 = claim_space(div18_nodes);
    			div8 = claim_element(div18_nodes, "DIV", { class: true });
    			var div8_nodes = children(div8);
    			div6 = claim_element(div8_nodes, "DIV", { class: true, style: true });
    			var div6_nodes = children(div6);
    			p2 = claim_element(div6_nodes, "P", { class: true });
    			var p2_nodes = children(p2);
    			t13 = claim_text(p2_nodes, "To Do");
    			p2_nodes.forEach(detach);
    			div6_nodes.forEach(detach);
    			t14 = claim_space(div8_nodes);
    			div7 = claim_element(div8_nodes, "DIV", { class: true });
    			var div7_nodes = children(div7);

    			for (let i = 0; i < each_blocks_3.length; i += 1) {
    				each_blocks_3[i].l(div7_nodes);
    			}

    			div7_nodes.forEach(detach);
    			div8_nodes.forEach(detach);
    			t15 = claim_space(div18_nodes);
    			div11 = claim_element(div18_nodes, "DIV", { class: true });
    			var div11_nodes = children(div11);
    			div9 = claim_element(div11_nodes, "DIV", { class: true, style: true });
    			var div9_nodes = children(div9);
    			p3 = claim_element(div9_nodes, "P", { class: true });
    			var p3_nodes = children(p3);
    			t16 = claim_text(p3_nodes, "Doing");
    			p3_nodes.forEach(detach);
    			div9_nodes.forEach(detach);
    			t17 = claim_space(div11_nodes);
    			div10 = claim_element(div11_nodes, "DIV", { class: true });
    			var div10_nodes = children(div10);

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				each_blocks_2[i].l(div10_nodes);
    			}

    			div10_nodes.forEach(detach);
    			div11_nodes.forEach(detach);
    			t18 = claim_space(div18_nodes);
    			div14 = claim_element(div18_nodes, "DIV", { class: true });
    			var div14_nodes = children(div14);
    			div12 = claim_element(div14_nodes, "DIV", { class: true, style: true });
    			var div12_nodes = children(div12);
    			p4 = claim_element(div12_nodes, "P", { class: true });
    			var p4_nodes = children(p4);
    			t19 = claim_text(p4_nodes, "Done");
    			p4_nodes.forEach(detach);
    			div12_nodes.forEach(detach);
    			t20 = claim_space(div14_nodes);
    			div13 = claim_element(div14_nodes, "DIV", { class: true });
    			var div13_nodes = children(div13);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].l(div13_nodes);
    			}

    			div13_nodes.forEach(detach);
    			div14_nodes.forEach(detach);
    			t21 = claim_space(div18_nodes);
    			div17 = claim_element(div18_nodes, "DIV", { class: true });
    			var div17_nodes = children(div17);
    			div15 = claim_element(div17_nodes, "DIV", { class: true, style: true });
    			var div15_nodes = children(div15);
    			p5 = claim_element(div15_nodes, "P", { class: true });
    			var p5_nodes = children(p5);
    			t22 = claim_text(p5_nodes, "Close");
    			p5_nodes.forEach(detach);
    			div15_nodes.forEach(detach);
    			t23 = claim_space(div17_nodes);
    			div16 = claim_element(div17_nodes, "DIV", { class: true });
    			var div16_nodes = children(div16);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(div16_nodes);
    			}

    			div16_nodes.forEach(detach);
    			div17_nodes.forEach(detach);
    			div18_nodes.forEach(detach);
    			main_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(p0, "class", "svelte-w8pctw");
    			attr(div0, "class", "button-center svelte-w8pctw");
    			attr(div1, "class", "left-section svelte-w8pctw");
    			attr(div2, "class", "left-sidebar svelte-w8pctw");
    			attr(p1, "class", "svelte-w8pctw");
    			attr(div3, "class", "header svelte-w8pctw");
    			set_style(div3, "background-color", openColor);
    			attr(div4, "class", "task-container svelte-w8pctw");
    			attr(div5, "class", "state svelte-w8pctw");
    			attr(p2, "class", "svelte-w8pctw");
    			attr(div6, "class", "header svelte-w8pctw");
    			set_style(div6, "background-color", todoColor);
    			attr(div7, "class", "task-container svelte-w8pctw");
    			attr(div8, "class", "state svelte-w8pctw");
    			attr(p3, "class", "svelte-w8pctw");
    			attr(div9, "class", "header svelte-w8pctw");
    			set_style(div9, "background-color", doingColor);
    			attr(div10, "class", "task-container svelte-w8pctw");
    			attr(div11, "class", "state svelte-w8pctw");
    			attr(p4, "class", "svelte-w8pctw");
    			attr(div12, "class", "header svelte-w8pctw");
    			set_style(div12, "background-color", doneColor);
    			attr(div13, "class", "task-container svelte-w8pctw");
    			attr(div14, "class", "state svelte-w8pctw");
    			attr(p5, "class", "svelte-w8pctw");
    			attr(div15, "class", "header svelte-w8pctw");
    			set_style(div15, "background-color", closeColor);
    			attr(div16, "class", "task-container svelte-w8pctw");
    			attr(div17, "class", "state svelte-w8pctw");
    			attr(div18, "class", "right svelte-w8pctw");
    			attr(main, "class", "container svelte-w8pctw");
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			append_hydration(main, div2);
    			append_hydration(div2, div1);
    			append_hydration(div1, p0);
    			append_hydration(p0, t0);
    			append_hydration(div1, t1);
    			append_hydration(div1, div0);
    			if (if_block0) if_block0.m(div0, null);
    			append_hydration(div0, t2);
    			if (if_block1) if_block1.m(div0, null);
    			append_hydration(div1, t3);
    			mount_component(scrollinglist, div1, null);
    			append_hydration(div2, t4);
    			if (if_block2) if_block2.m(div2, null);
    			append_hydration(main, t5);
    			if (if_block3) if_block3.m(main, null);
    			append_hydration(main, t6);
    			if (if_block4) if_block4.m(main, null);
    			append_hydration(main, t7);
    			if (if_block5) if_block5.m(main, null);
    			append_hydration(main, t8);
    			append_hydration(main, div18);
    			append_hydration(div18, div5);
    			append_hydration(div5, div3);
    			append_hydration(div3, p1);
    			append_hydration(p1, t9);
    			append_hydration(div5, t10);
    			if (if_block6) if_block6.m(div5, null);
    			append_hydration(div5, t11);
    			append_hydration(div5, div4);

    			for (let i = 0; i < each_blocks_4.length; i += 1) {
    				each_blocks_4[i].m(div4, null);
    			}

    			append_hydration(div18, t12);
    			append_hydration(div18, div8);
    			append_hydration(div8, div6);
    			append_hydration(div6, p2);
    			append_hydration(p2, t13);
    			append_hydration(div8, t14);
    			append_hydration(div8, div7);

    			for (let i = 0; i < each_blocks_3.length; i += 1) {
    				each_blocks_3[i].m(div7, null);
    			}

    			append_hydration(div18, t15);
    			append_hydration(div18, div11);
    			append_hydration(div11, div9);
    			append_hydration(div9, p3);
    			append_hydration(p3, t16);
    			append_hydration(div11, t17);
    			append_hydration(div11, div10);

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				each_blocks_2[i].m(div10, null);
    			}

    			append_hydration(div18, t18);
    			append_hydration(div18, div14);
    			append_hydration(div14, div12);
    			append_hydration(div12, p4);
    			append_hydration(p4, t19);
    			append_hydration(div14, t20);
    			append_hydration(div14, div13);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(div13, null);
    			}

    			append_hydration(div18, t21);
    			append_hydration(div18, div17);
    			append_hydration(div17, div15);
    			append_hydration(div15, p5);
    			append_hydration(p5, t22);
    			append_hydration(div17, t23);
    			append_hydration(div17, div16);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div16, null);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*showcreateappB*/ ctx[2]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);

    					if (dirty[0] & /*showcreateappB*/ 4) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_12(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(div0, t2);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			if (/*showcreateappB*/ ctx[2] && /*appselected*/ ctx[8] !== "allapps") {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);

    					if (dirty[0] & /*showcreateappB, appselected*/ 260) {
    						transition_in(if_block1, 1);
    					}
    				} else {
    					if_block1 = create_if_block_11(ctx);
    					if_block1.c();
    					transition_in(if_block1, 1);
    					if_block1.m(div0, null);
    				}
    			} else if (if_block1) {
    				group_outros();

    				transition_out(if_block1, 1, 1, () => {
    					if_block1 = null;
    				});

    				check_outros();
    			}

    			const scrollinglist_changes = {};
    			if (dirty[0] & /*apps*/ 32) scrollinglist_changes.arr = ["allapps", .../*apps*/ ctx[5]];
    			if (dirty[0] & /*appselected*/ 256) scrollinglist_changes.appselected = /*appselected*/ ctx[8];
    			if (dirty[0] & /*planselected*/ 512) scrollinglist_changes.planselected = /*planselected*/ ctx[9];
    			scrollinglist.$set(scrollinglist_changes);

    			if (/*appselected*/ ctx[8] != "allapps") {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);

    					if (dirty[0] & /*appselected*/ 256) {
    						transition_in(if_block2, 1);
    					}
    				} else {
    					if_block2 = create_if_block_9$1(ctx);
    					if_block2.c();
    					transition_in(if_block2, 1);
    					if_block2.m(div2, null);
    				}
    			} else if (if_block2) {
    				group_outros();

    				transition_out(if_block2, 1, 1, () => {
    					if_block2 = null;
    				});

    				check_outros();
    			}

    			if (/*appForm*/ ctx[11]) {
    				if (if_block3) {
    					if_block3.p(ctx, dirty);

    					if (dirty[0] & /*appForm*/ 2048) {
    						transition_in(if_block3, 1);
    					}
    				} else {
    					if_block3 = create_if_block_8$1(ctx);
    					if_block3.c();
    					transition_in(if_block3, 1);
    					if_block3.m(main, t6);
    				}
    			} else if (if_block3) {
    				group_outros();

    				transition_out(if_block3, 1, 1, () => {
    					if_block3 = null;
    				});

    				check_outros();
    			}

    			if (/*taskForm*/ ctx[12]) {
    				if (if_block4) {
    					if_block4.p(ctx, dirty);

    					if (dirty[0] & /*taskForm*/ 4096) {
    						transition_in(if_block4, 1);
    					}
    				} else {
    					if_block4 = create_if_block_7$1(ctx);
    					if_block4.c();
    					transition_in(if_block4, 1);
    					if_block4.m(main, t7);
    				}
    			} else if (if_block4) {
    				group_outros();

    				transition_out(if_block4, 1, 1, () => {
    					if_block4 = null;
    				});

    				check_outros();
    			}

    			if (/*createPlan*/ ctx[10]) {
    				if (if_block5) {
    					if_block5.p(ctx, dirty);

    					if (dirty[0] & /*createPlan*/ 1024) {
    						transition_in(if_block5, 1);
    					}
    				} else {
    					if_block5 = create_if_block_6$1(ctx);
    					if_block5.c();
    					transition_in(if_block5, 1);
    					if_block5.m(main, t8);
    				}
    			} else if (if_block5) {
    				group_outros();

    				transition_out(if_block5, 1, 1, () => {
    					if_block5 = null;
    				});

    				check_outros();
    			}

    			if (/*showcreatetaskB*/ ctx[0] && /*appselected*/ ctx[8] !== "allapps") {
    				if (if_block6) {
    					if_block6.p(ctx, dirty);

    					if (dirty[0] & /*showcreatetaskB, appselected*/ 257) {
    						transition_in(if_block6, 1);
    					}
    				} else {
    					if_block6 = create_if_block_5$1(ctx);
    					if_block6.c();
    					transition_in(if_block6, 1);
    					if_block6.m(div5, t11);
    				}
    			} else if (if_block6) {
    				group_outros();

    				transition_out(if_block6, 1, 1, () => {
    					if_block6 = null;
    				});

    				check_outros();
    			}

    			if (dirty[0] & /*filteredtask, filteredplans, getAllUpdatedTask*/ 131208) {
    				each_value_4 = /*filteredtask*/ ctx[3];
    				let i;

    				for (i = 0; i < each_value_4.length; i += 1) {
    					const child_ctx = get_each_context_4(ctx, each_value_4, i);

    					if (each_blocks_4[i]) {
    						each_blocks_4[i].p(child_ctx, dirty);
    						transition_in(each_blocks_4[i], 1);
    					} else {
    						each_blocks_4[i] = create_each_block_4(child_ctx);
    						each_blocks_4[i].c();
    						transition_in(each_blocks_4[i], 1);
    						each_blocks_4[i].m(div4, null);
    					}
    				}

    				group_outros();

    				for (i = each_value_4.length; i < each_blocks_4.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}

    			if (dirty[0] & /*filteredtask, filteredplans, getAllUpdatedTask*/ 131208) {
    				each_value_3 = /*filteredtask*/ ctx[3];
    				let i;

    				for (i = 0; i < each_value_3.length; i += 1) {
    					const child_ctx = get_each_context_3(ctx, each_value_3, i);

    					if (each_blocks_3[i]) {
    						each_blocks_3[i].p(child_ctx, dirty);
    						transition_in(each_blocks_3[i], 1);
    					} else {
    						each_blocks_3[i] = create_each_block_3(child_ctx);
    						each_blocks_3[i].c();
    						transition_in(each_blocks_3[i], 1);
    						each_blocks_3[i].m(div7, null);
    					}
    				}

    				group_outros();

    				for (i = each_value_3.length; i < each_blocks_3.length; i += 1) {
    					out_1(i);
    				}

    				check_outros();
    			}

    			if (dirty[0] & /*filteredtask, filteredplans, getAllUpdatedTask*/ 131208) {
    				each_value_2 = /*filteredtask*/ ctx[3];
    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks_2[i]) {
    						each_blocks_2[i].p(child_ctx, dirty);
    						transition_in(each_blocks_2[i], 1);
    					} else {
    						each_blocks_2[i] = create_each_block_2(child_ctx);
    						each_blocks_2[i].c();
    						transition_in(each_blocks_2[i], 1);
    						each_blocks_2[i].m(div10, null);
    					}
    				}

    				group_outros();

    				for (i = each_value_2.length; i < each_blocks_2.length; i += 1) {
    					out_2(i);
    				}

    				check_outros();
    			}

    			if (dirty[0] & /*filteredtask, filteredplans, getAllUpdatedTask*/ 131208) {
    				each_value_1 = /*filteredtask*/ ctx[3];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1$1(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    						transition_in(each_blocks_1[i], 1);
    					} else {
    						each_blocks_1[i] = create_each_block_1$1(child_ctx);
    						each_blocks_1[i].c();
    						transition_in(each_blocks_1[i], 1);
    						each_blocks_1[i].m(div13, null);
    					}
    				}

    				group_outros();

    				for (i = each_value_1.length; i < each_blocks_1.length; i += 1) {
    					out_3(i);
    				}

    				check_outros();
    			}

    			if (dirty[0] & /*filteredtask, filteredplans, getAllUpdatedTask*/ 131208) {
    				each_value = /*filteredtask*/ ctx[3];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$3(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block$3(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(div16, null);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out_4(i);
    				}

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block0);
    			transition_in(if_block1);
    			transition_in(scrollinglist.$$.fragment, local);
    			transition_in(if_block2);
    			transition_in(if_block3);
    			transition_in(if_block4);
    			transition_in(if_block5);
    			transition_in(if_block6);

    			for (let i = 0; i < each_value_4.length; i += 1) {
    				transition_in(each_blocks_4[i]);
    			}

    			for (let i = 0; i < each_value_3.length; i += 1) {
    				transition_in(each_blocks_3[i]);
    			}

    			for (let i = 0; i < each_value_2.length; i += 1) {
    				transition_in(each_blocks_2[i]);
    			}

    			for (let i = 0; i < each_value_1.length; i += 1) {
    				transition_in(each_blocks_1[i]);
    			}

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			transition_out(if_block0);
    			transition_out(if_block1);
    			transition_out(scrollinglist.$$.fragment, local);
    			transition_out(if_block2);
    			transition_out(if_block3);
    			transition_out(if_block4);
    			transition_out(if_block5);
    			transition_out(if_block6);
    			each_blocks_4 = each_blocks_4.filter(Boolean);

    			for (let i = 0; i < each_blocks_4.length; i += 1) {
    				transition_out(each_blocks_4[i]);
    			}

    			each_blocks_3 = each_blocks_3.filter(Boolean);

    			for (let i = 0; i < each_blocks_3.length; i += 1) {
    				transition_out(each_blocks_3[i]);
    			}

    			each_blocks_2 = each_blocks_2.filter(Boolean);

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				transition_out(each_blocks_2[i]);
    			}

    			each_blocks_1 = each_blocks_1.filter(Boolean);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				transition_out(each_blocks_1[i]);
    			}

    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			destroy_component(scrollinglist);
    			if (if_block2) if_block2.d();
    			if (if_block3) if_block3.d();
    			if (if_block4) if_block4.d();
    			if (if_block5) if_block5.d();
    			if (if_block6) if_block6.d();
    			destroy_each(each_blocks_4, detaching);
    			destroy_each(each_blocks_3, detaching);
    			destroy_each(each_blocks_2, detaching);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    let openColor = "#e7d3ec";
    let todoColor = "#e1e157";
    let doingColor = "#e2bb74";
    let doneColor = "#c2e5ae";
    let closeColor = "#f1a99b";

    function instance$d($$self, $$props, $$invalidate) {
    	let $applicationMethods;
    	component_subscribe($$self, applicationMethods, $$value => $$invalidate(26, $applicationMethods = $$value));
    	let showcreatetaskB = false;
    	let showcreateplanB = false;
    	let showcreateappB = false;
    	let initialtask = [];
    	let filteredtask = [];
    	let appData = [];
    	let apps = [];
    	let plans = [];
    	let filteredplans = [];
    	let appselected = "allapps";
    	let planselected = "allplans";
    	let createPlan = false;
    	let appForm = false;
    	let taskForm = false;
    	let editapp = false;

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
    					$$invalidate(3, filteredtask = initialtask);
    					resolve();
    				}).catch(err => {
    					console.log(err);
    				});
    			});
    	};

    	const fetchtaskbyapp = () => {
    		return new Promise((resolve, reject) => {
    				const url = "http://localhost:8080/getalltaskbyacronym";

    				fetch(url, {
    					method: "POST",
    					body: JSON.stringify({
    						editor: sessionStorage.getItem("JWT"),
    						taskacronym: appselected
    					})
    				}).then(response => response.json()).then(data => {
    					$$invalidate(3, filteredtask = data);
    				}).catch(err => {
    					console.log(err);
    				});
    			});
    	};

    	const fetchplansbyapp = () => {
    		return new Promise((resolve, reject) => {
    				const url = "http://localhost:8080/getplanbyapp";

    				fetch(url, {
    					method: "POST",
    					body: JSON.stringify({
    						editor: sessionStorage.getItem("JWT"),
    						acronym: appselected
    					})
    				}).then(response => response.json()).then(data => {
    					$$invalidate(7, filteredplans = data.map(e => e.planname));
    					resolve();
    				}).catch(err => {
    					console.log(err);
    				});
    			});
    	};

    	const fetchtaskbyappplan = () => {
    		return new Promise((resolve, reject) => {
    				const url = "http://localhost:8080/getalltaskbyacronymnplan";

    				fetch(url, {
    					method: "POST",
    					body: JSON.stringify({
    						editor: sessionStorage.getItem("JWT"),
    						taskacronym: appselected,
    						taskplan: planselected
    					})
    				}).then(response => response.json()).then(data => {
    					$$invalidate(3, filteredtask = data);
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
    					$$invalidate(4, appData = data);
    					$$invalidate(5, apps = data.map(app => app.appacronym));
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
    					$$invalidate(6, plans = data.map(plan => plan.planname));
    					resolve();
    				}).catch(err => {
    					console.log(err);
    				});
    			});
    	};

    	const showCreatePlan = () => {
    		$$invalidate(10, createPlan = true);
    	};

    	const closeCreatePlan = () => {
    		$$invalidate(10, createPlan = false);
    	};

    	const getAllUpdatedTask = async () => {
    		if (appselected === "allapps") {
    			fetchtask();
    		} else if (appselected !== "allapps" && planselected === "allplans") {
    			fetchtaskbyapp();
    		} else if (planselected !== "allplans" && appselected !== "allapps") {
    			fetchtaskbyappplan();
    		}
    	};

    	const toggleAppForm = e => {
    		if (e.currentTarget) {
    			if (e.currentTarget.id === "editapp") {
    				$$invalidate(13, editapp = true);
    			} else {
    				$$invalidate(13, editapp = false);
    			}
    		}

    		$$invalidate(11, appForm = !appForm);
    	};

    	const toggleTaskForm = () => {
    		$$invalidate(12, taskForm = !taskForm);
    	};

    	const filterTaskByApp = async event => {
    		$$invalidate(8, appselected = event.detail);

    		if (appselected === "allapps") {
    			await fetchtask();
    		} else if (appselected !== "allapps") {
    			await fetchtask(); // filteredtask = initialtask
    			$$invalidate(3, filteredtask = initialtask.filter(e => e.taskacronym === appselected));
    			await fetchplansbyapp();
    			$$invalidate(9, planselected = "allplans");
    			createTaskPermission();
    			createPlanPermission();
    		}
    	};

    	const filterTaskByAppPlan = async event => {
    		$$invalidate(9, planselected = event.detail);

    		if (planselected === "allplans") {
    			await fetchtaskbyapp();
    		} else {
    			await fetchtaskbyappplan();
    			$$invalidate(3, filteredtask = filteredtask.filter(e => e.taskplan === planselected));
    		}
    	};

    	const checkGroup = (token, group, type) => {
    		const url = "http://localhost:8080/authorize";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({ token, group })
    		}).then(response => response.json()).then(data => {
    			if (data.Message === "true") {
    				if (type === "task") {
    					$$invalidate(0, showcreatetaskB = true);
    				} else if (type === "plan") {
    					$$invalidate(1, showcreateplanB = true);
    				} else if (type === "app") {
    					$$invalidate(2, showcreateappB = true);
    				}
    			} else {
    				if (type === "task") {
    					$$invalidate(0, showcreatetaskB = false);
    				} else if (type === "plan") {
    					$$invalidate(1, showcreateplanB = false);
    				} else if (type === "app") {
    					$$invalidate(1, showcreateplanB = false);
    				}
    			}
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const createTaskPermission = () => {
    		if ($applicationMethods.filter(e => e.appname === appselected).length === 0) {
    			$$invalidate(0, showcreatetaskB = false);
    		} else {
    			checkGroup(sessionStorage.getItem("JWT"), $applicationMethods.filter(e => e.appname === appselected)[0]["permitCreate"], "task");
    		}
    	};

    	const createPlanPermission = () => {
    		if ($applicationMethods.filter(e => e.appname === appselected).length === 0) {
    			$$invalidate(1, showcreateplanB = false);
    		} else {
    			checkGroup(sessionStorage.getItem("JWT"), $applicationMethods.filter(e => e.appname === appselected)[0]["permitOpen"], "plan");
    		}
    	};

    	const createAppPermission = () => {
    		checkGroup(sessionStorage.getItem("JWT"), "configmanager", "app");
    	};

    	const updateApp = async () => {
    		await fetchApps();
    		addAppPermissionData();
    		createTaskPermission();
    		createPlanPermission();
    	};

    	const update_handler = async () => await fetchplansbyapp();

    	return [
    		showcreatetaskB,
    		showcreateplanB,
    		showcreateappB,
    		filteredtask,
    		appData,
    		apps,
    		plans,
    		filteredplans,
    		appselected,
    		planselected,
    		createPlan,
    		appForm,
    		taskForm,
    		editapp,
    		fetchplansbyapp,
    		showCreatePlan,
    		closeCreatePlan,
    		getAllUpdatedTask,
    		toggleAppForm,
    		toggleTaskForm,
    		filterTaskByApp,
    		filterTaskByAppPlan,
    		updateApp,
    		update_handler
    	];
    }

    class DashboardContent extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$d, create_fragment$j, safe_not_equal, {}, null, [-1, -1]);
    	}
    }

    /* src\page\Dashboard.svelte generated by Svelte v3.50.1 */

    function create_fragment$i(ctx) {
    	let main;
    	let navbar;
    	let t;
    	let dashboardcontent;
    	let current;
    	navbar = new Navbar({});
    	dashboardcontent = new DashboardContent({});

    	return {
    		c() {
    			main = element("main");
    			create_component(navbar.$$.fragment);
    			t = space();
    			create_component(dashboardcontent.$$.fragment);
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			claim_component(navbar.$$.fragment, main_nodes);
    			t = claim_space(main_nodes);
    			claim_component(dashboardcontent.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			mount_component(navbar, main, null);
    			append_hydration(main, t);
    			mount_component(dashboardcontent, main, null);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(dashboardcontent.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(dashboardcontent.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(navbar);
    			destroy_component(dashboardcontent);
    		}
    	};
    }

    class Dashboard extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$i, safe_not_equal, {});
    	}
    }

    /* node_modules\svelte-multiselect\CircleSpinner.svelte generated by Svelte v3.50.1 */

    function create_fragment$h(ctx) {
    	let div;

    	let style_border_color = `${/*color*/ ctx[0]} transparent ${/*color*/ ctx[0]}
  ${/*color*/ ctx[0]}`;

    	return {
    		c() {
    			div = element("div");
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { style: true, class: true });
    			children(div).forEach(detach);
    			this.h();
    		},
    		h() {
    			set_style(div, "--duration", /*duration*/ ctx[1]);
    			attr(div, "class", "svelte-66wdl1");
    			set_style(div, "border-color", style_border_color, false);
    			set_style(div, "width", /*size*/ ctx[2], false);
    			set_style(div, "height", /*size*/ ctx[2], false);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*duration*/ 2) {
    				set_style(div, "--duration", /*duration*/ ctx[1]);
    			}

    			if (dirty & /*color*/ 1 && style_border_color !== (style_border_color = `${/*color*/ ctx[0]} transparent ${/*color*/ ctx[0]}
  ${/*color*/ ctx[0]}`)) {
    				set_style(div, "border-color", style_border_color, false);
    			}

    			if (dirty & /*size*/ 4) {
    				set_style(div, "width", /*size*/ ctx[2], false);
    			}

    			if (dirty & /*size*/ 4) {
    				set_style(div, "height", /*size*/ ctx[2], false);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    function instance$c($$self, $$props, $$invalidate) {
    	let { color = `cornflowerblue` } = $$props;
    	let { duration = `1.5s` } = $$props;
    	let { size = `1em` } = $$props;

    	$$self.$$set = $$props => {
    		if ('color' in $$props) $$invalidate(0, color = $$props.color);
    		if ('duration' in $$props) $$invalidate(1, duration = $$props.duration);
    		if ('size' in $$props) $$invalidate(2, size = $$props.size);
    	};

    	return [color, duration, size];
    }

    class CircleSpinner extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$c, create_fragment$h, safe_not_equal, { color: 0, duration: 1, size: 2 });
    	}
    }

    /* node_modules\svelte-multiselect\icons\ChevronExpand.svelte generated by Svelte v3.50.1 */

    function create_fragment$g(ctx) {
    	let svg;
    	let path;
    	let svg_levels = [/*$$props*/ ctx[0], { fill: "currentColor" }, { viewBox: "0 0 16 16" }];
    	let svg_data = {};

    	for (let i = 0; i < svg_levels.length; i += 1) {
    		svg_data = assign(svg_data, svg_levels[i]);
    	}

    	return {
    		c() {
    			svg = svg_element("svg");
    			path = svg_element("path");
    			this.h();
    		},
    		l(nodes) {
    			svg = claim_svg_element(nodes, "svg", { fill: true, viewBox: true });
    			var svg_nodes = children(svg);
    			path = claim_svg_element(svg_nodes, "path", { d: true });
    			children(path).forEach(detach);
    			svg_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(path, "d", "M3.646 9.146a.5.5 0 0 1 .708 0L8 12.793l3.646-3.647a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 0-.708zm0-2.292a.5.5 0 0 0 .708 0L8 3.207l3.646 3.647a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 0 0 0 .708z");
    			set_svg_attributes(svg, svg_data);
    		},
    		m(target, anchor) {
    			insert_hydration(target, svg, anchor);
    			append_hydration(svg, path);
    		},
    		p(ctx, [dirty]) {
    			set_svg_attributes(svg, svg_data = get_spread_update(svg_levels, [
    				dirty & /*$$props*/ 1 && /*$$props*/ ctx[0],
    				{ fill: "currentColor" },
    				{ viewBox: "0 0 16 16" }
    			]));
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    		}
    	};
    }

    function instance$b($$self, $$props, $$invalidate) {
    	$$self.$$set = $$new_props => {
    		$$invalidate(0, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    	};

    	$$props = exclude_internal_props($$props);
    	return [$$props];
    }

    class ChevronExpand extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$b, create_fragment$g, safe_not_equal, {});
    	}
    }

    /* node_modules\svelte-multiselect\icons\Cross.svelte generated by Svelte v3.50.1 */

    function create_fragment$f(ctx) {
    	let svg;
    	let path;
    	let svg_levels = [/*$$props*/ ctx[0], { viewBox: "0 0 20 20" }, { fill: "currentColor" }];
    	let svg_data = {};

    	for (let i = 0; i < svg_levels.length; i += 1) {
    		svg_data = assign(svg_data, svg_levels[i]);
    	}

    	return {
    		c() {
    			svg = svg_element("svg");
    			path = svg_element("path");
    			this.h();
    		},
    		l(nodes) {
    			svg = claim_svg_element(nodes, "svg", { viewBox: true, fill: true });
    			var svg_nodes = children(svg);
    			path = claim_svg_element(svg_nodes, "path", { d: true });
    			children(path).forEach(detach);
    			svg_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(path, "d", "M10 1.6a8.4 8.4 0 100 16.8 8.4 8.4 0 000-16.8zm4.789 11.461L13.06 14.79 10 11.729l-3.061 3.06L5.21 13.06 8.272 10 5.211 6.939 6.94 5.211 10 8.271l3.061-3.061 1.729 1.729L11.728 10l3.061 3.061z");
    			set_svg_attributes(svg, svg_data);
    		},
    		m(target, anchor) {
    			insert_hydration(target, svg, anchor);
    			append_hydration(svg, path);
    		},
    		p(ctx, [dirty]) {
    			set_svg_attributes(svg, svg_data = get_spread_update(svg_levels, [
    				dirty & /*$$props*/ 1 && /*$$props*/ ctx[0],
    				{ viewBox: "0 0 20 20" },
    				{ fill: "currentColor" }
    			]));
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    		}
    	};
    }

    function instance$a($$self, $$props, $$invalidate) {
    	$$self.$$set = $$new_props => {
    		$$invalidate(0, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    	};

    	$$props = exclude_internal_props($$props);
    	return [$$props];
    }

    class Cross extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$a, create_fragment$f, safe_not_equal, {});
    	}
    }

    /* node_modules\svelte-multiselect\icons\Disabled.svelte generated by Svelte v3.50.1 */

    function create_fragment$e(ctx) {
    	let svg;
    	let path0;
    	let path1;
    	let svg_levels = [/*$$props*/ ctx[0], { viewBox: "0 0 24 24" }, { fill: "currentColor" }];
    	let svg_data = {};

    	for (let i = 0; i < svg_levels.length; i += 1) {
    		svg_data = assign(svg_data, svg_levels[i]);
    	}

    	return {
    		c() {
    			svg = svg_element("svg");
    			path0 = svg_element("path");
    			path1 = svg_element("path");
    			this.h();
    		},
    		l(nodes) {
    			svg = claim_svg_element(nodes, "svg", { viewBox: true, fill: true });
    			var svg_nodes = children(svg);
    			path0 = claim_svg_element(svg_nodes, "path", { fill: true, d: true });
    			children(path0).forEach(detach);
    			path1 = claim_svg_element(svg_nodes, "path", { d: true });
    			children(path1).forEach(detach);
    			svg_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(path0, "fill", "none");
    			attr(path0, "d", "M0 0h24v24H0V0z");
    			attr(path1, "d", "M14.48 11.95c.17.02.34.05.52.05 2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4c0 .18.03.35.05.52l3.43 3.43zm2.21 2.21L22.53 20H23v-2c0-2.14-3.56-3.5-6.31-3.84zM0 3.12l4 4V10H1v2h3v3h2v-3h2.88l2.51 2.51C9.19 15.11 7 16.3 7 18v2h9.88l4 4 1.41-1.41L1.41 1.71 0 3.12zM6.88 10H6v-.88l.88.88z");
    			set_svg_attributes(svg, svg_data);
    		},
    		m(target, anchor) {
    			insert_hydration(target, svg, anchor);
    			append_hydration(svg, path0);
    			append_hydration(svg, path1);
    		},
    		p(ctx, [dirty]) {
    			set_svg_attributes(svg, svg_data = get_spread_update(svg_levels, [
    				dirty & /*$$props*/ 1 && /*$$props*/ ctx[0],
    				{ viewBox: "0 0 24 24" },
    				{ fill: "currentColor" }
    			]));
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    		}
    	};
    }

    function instance$9($$self, $$props, $$invalidate) {
    	$$self.$$set = $$new_props => {
    		$$invalidate(0, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    	};

    	$$props = exclude_internal_props($$props);
    	return [$$props];
    }

    class Disabled extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$9, create_fragment$e, safe_not_equal, {});
    	}
    }

    function is_date(obj) {
        return Object.prototype.toString.call(obj) === '[object Date]';
    }

    function tick_spring(ctx, last_value, current_value, target_value) {
        if (typeof current_value === 'number' || is_date(current_value)) {
            // @ts-ignore
            const delta = target_value - current_value;
            // @ts-ignore
            const velocity = (current_value - last_value) / (ctx.dt || 1 / 60); // guard div by 0
            const spring = ctx.opts.stiffness * delta;
            const damper = ctx.opts.damping * velocity;
            const acceleration = (spring - damper) * ctx.inv_mass;
            const d = (velocity + acceleration) * ctx.dt;
            if (Math.abs(d) < ctx.opts.precision && Math.abs(delta) < ctx.opts.precision) {
                return target_value; // settled
            }
            else {
                ctx.settled = false; // signal loop to keep ticking
                // @ts-ignore
                return is_date(current_value) ?
                    new Date(current_value.getTime() + d) : current_value + d;
            }
        }
        else if (Array.isArray(current_value)) {
            // @ts-ignore
            return current_value.map((_, i) => tick_spring(ctx, last_value[i], current_value[i], target_value[i]));
        }
        else if (typeof current_value === 'object') {
            const next_value = {};
            for (const k in current_value) {
                // @ts-ignore
                next_value[k] = tick_spring(ctx, last_value[k], current_value[k], target_value[k]);
            }
            // @ts-ignore
            return next_value;
        }
        else {
            throw new Error(`Cannot spring ${typeof current_value} values`);
        }
    }
    function spring(value, opts = {}) {
        const store = writable(value);
        const { stiffness = 0.15, damping = 0.8, precision = 0.01 } = opts;
        let last_time;
        let task;
        let current_token;
        let last_value = value;
        let target_value = value;
        let inv_mass = 1;
        let inv_mass_recovery_rate = 0;
        let cancel_task = false;
        function set(new_value, opts = {}) {
            target_value = new_value;
            const token = current_token = {};
            if (value == null || opts.hard || (spring.stiffness >= 1 && spring.damping >= 1)) {
                cancel_task = true; // cancel any running animation
                last_time = now();
                last_value = new_value;
                store.set(value = target_value);
                return Promise.resolve();
            }
            else if (opts.soft) {
                const rate = opts.soft === true ? .5 : +opts.soft;
                inv_mass_recovery_rate = 1 / (rate * 60);
                inv_mass = 0; // infinite mass, unaffected by spring forces
            }
            if (!task) {
                last_time = now();
                cancel_task = false;
                task = loop(now => {
                    if (cancel_task) {
                        cancel_task = false;
                        task = null;
                        return false;
                    }
                    inv_mass = Math.min(inv_mass + inv_mass_recovery_rate, 1);
                    const ctx = {
                        inv_mass,
                        opts: spring,
                        settled: true,
                        dt: (now - last_time) * 60 / 1000
                    };
                    const next_value = tick_spring(ctx, last_value, value, target_value);
                    last_time = now;
                    last_value = value;
                    store.set(value = next_value);
                    if (ctx.settled) {
                        task = null;
                    }
                    return !ctx.settled;
                });
            }
            return new Promise(fulfil => {
                task.promise.then(() => {
                    if (token === current_token)
                        fulfil();
                });
            });
        }
        const spring = {
            set,
            update: (fn, opts) => set(fn(target_value, value), opts),
            subscribe: store.subscribe,
            stiffness,
            damping,
            precision
        };
        return spring;
    }

    /* node_modules\svelte-multiselect\Wiggle.svelte generated by Svelte v3.50.1 */

    function create_fragment$d(ctx) {
    	let span;

    	let style_transform = `rotate(${/*$store*/ ctx[0].angle}deg) scale(${/*$store*/ ctx[0].scale}) translate(${/*$store*/ ctx[0].dx}px,
  ${/*$store*/ ctx[0].dy}px)`;

    	let current;
    	const default_slot_template = /*#slots*/ ctx[11].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[10], null);

    	return {
    		c() {
    			span = element("span");
    			if (default_slot) default_slot.c();
    			this.h();
    		},
    		l(nodes) {
    			span = claim_element(nodes, "SPAN", {});
    			var span_nodes = children(span);
    			if (default_slot) default_slot.l(span_nodes);
    			span_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			set_style(span, "transform", style_transform, false);
    		},
    		m(target, anchor) {
    			insert_hydration(target, span, anchor);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 1024)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[10],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[10])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[10], dirty, null),
    						null
    					);
    				}
    			}

    			if (dirty & /*$store*/ 1 && style_transform !== (style_transform = `rotate(${/*$store*/ ctx[0].angle}deg) scale(${/*$store*/ ctx[0].scale}) translate(${/*$store*/ ctx[0].dx}px,
  ${/*$store*/ ctx[0].dy}px)`)) {
    				set_style(span, "transform", style_transform, false);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    function instance$8($$self, $$props, $$invalidate) {
    	let $store;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { wiggle = false } = $$props;
    	let { angle = 0 } = $$props;
    	let { scale = 1 } = $$props;
    	let { dx = 0 } = $$props;
    	let { dy = 0 } = $$props;
    	let { duration = 200 } = $$props;
    	let { stiffness = 0.05 } = $$props;
    	let { damping = 0.1 } = $$props;
    	let restState = { angle: 0, scale: 1, dx: 0, dy: 0 };
    	let store = spring(restState, { stiffness, damping });
    	component_subscribe($$self, store, value => $$invalidate(0, $store = value));

    	$$self.$$set = $$props => {
    		if ('wiggle' in $$props) $$invalidate(2, wiggle = $$props.wiggle);
    		if ('angle' in $$props) $$invalidate(3, angle = $$props.angle);
    		if ('scale' in $$props) $$invalidate(4, scale = $$props.scale);
    		if ('dx' in $$props) $$invalidate(5, dx = $$props.dx);
    		if ('dy' in $$props) $$invalidate(6, dy = $$props.dy);
    		if ('duration' in $$props) $$invalidate(7, duration = $$props.duration);
    		if ('stiffness' in $$props) $$invalidate(8, stiffness = $$props.stiffness);
    		if ('damping' in $$props) $$invalidate(9, damping = $$props.damping);
    		if ('$$scope' in $$props) $$invalidate(10, $$scope = $$props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*wiggle, duration*/ 132) {
    			if (wiggle) setTimeout(() => $$invalidate(2, wiggle = false), duration);
    		}

    		if ($$self.$$.dirty & /*wiggle, scale, angle, dx, dy*/ 124) {
    			store.set(wiggle ? { scale, angle, dx, dy } : restState);
    		}
    	};

    	return [
    		$store,
    		store,
    		wiggle,
    		angle,
    		scale,
    		dx,
    		dy,
    		duration,
    		stiffness,
    		damping,
    		$$scope,
    		slots
    	];
    }

    class Wiggle extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$8, create_fragment$d, safe_not_equal, {
    			wiggle: 2,
    			angle: 3,
    			scale: 4,
    			dx: 5,
    			dy: 6,
    			duration: 7,
    			stiffness: 8,
    			damping: 9
    		});
    	}
    }

    /* node_modules\svelte-multiselect\MultiSelect.svelte generated by Svelte v3.50.1 */

    function get_each_context$2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[78] = list[i];
    	child_ctx[85] = i;

    	const constants_0 = /*option*/ child_ctx[78] instanceof Object
    	? /*option*/ child_ctx[78]
    	: { label: /*option*/ child_ctx[78] };

    	child_ctx[79] = constants_0.label;

    	child_ctx[33] = constants_0.disabled !== undefined
    	? constants_0.disabled
    	: null;

    	child_ctx[80] = constants_0.title !== undefined
    	? constants_0.title
    	: null;

    	child_ctx[81] = constants_0.selectedTitle !== undefined
    	? constants_0.selectedTitle
    	: null;

    	child_ctx[82] = constants_0.disabledTitle !== undefined
    	? constants_0.disabledTitle
    	: child_ctx[13];

    	const constants_1 = /*activeIndex*/ child_ctx[0] === /*idx*/ child_ctx[85];
    	child_ctx[83] = constants_1;
    	return child_ctx;
    }

    const get_option_slot_changes = dirty => ({ option: dirty[0] & /*matchingOptions*/ 2 });

    const get_option_slot_context = ctx => ({
    	option: /*option*/ ctx[78],
    	idx: /*idx*/ ctx[85]
    });

    const get_remove_icon_slot_changes_1 = dirty => ({});
    const get_remove_icon_slot_context_1 = ctx => ({});
    const get_disabled_icon_slot_changes = dirty => ({});
    const get_disabled_icon_slot_context = ctx => ({});
    const get_spinner_slot_changes = dirty => ({});
    const get_spinner_slot_context = ctx => ({});

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[78] = list[i];
    	child_ctx[85] = i;
    	return child_ctx;
    }

    const get_remove_icon_slot_changes = dirty => ({});
    const get_remove_icon_slot_context = ctx => ({});
    const get_selected_slot_changes = dirty => ({ option: dirty[0] & /*selected*/ 16 });

    const get_selected_slot_context = ctx => ({
    	option: /*option*/ ctx[78],
    	idx: /*idx*/ ctx[85]
    });

    // (300:10) {:else}
    function create_else_block_3(ctx) {
    	let t_value = get_label(/*option*/ ctx[78]) + "";
    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		l(nodes) {
    			t = claim_text(nodes, t_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*selected*/ 16 && t_value !== (t_value = get_label(/*option*/ ctx[78]) + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (298:10) {#if parseLabelsAsHtml}
    function create_if_block_9(ctx) {
    	let html_tag;
    	let raw_value = get_label(/*option*/ ctx[78]) + "";
    	let html_anchor;

    	return {
    		c() {
    			html_tag = new HtmlTagHydration(false);
    			html_anchor = empty();
    			this.h();
    		},
    		l(nodes) {
    			html_tag = claim_html_tag(nodes, false);
    			html_anchor = empty();
    			this.h();
    		},
    		h() {
    			html_tag.a = html_anchor;
    		},
    		m(target, anchor) {
    			html_tag.m(raw_value, target, anchor);
    			insert_hydration(target, html_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*selected*/ 16 && raw_value !== (raw_value = get_label(/*option*/ ctx[78]) + "")) html_tag.p(raw_value);
    		},
    		d(detaching) {
    			if (detaching) detach(html_anchor);
    			if (detaching) html_tag.d();
    		}
    	};
    }

    // (297:45)            
    function fallback_block_5(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*parseLabelsAsHtml*/ ctx[26]) return create_if_block_9;
    		return create_else_block_3;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (304:8) {#if !disabled}
    function create_if_block_8(ctx) {
    	let button;
    	let button_title_value;
    	let current;
    	let mounted;
    	let dispose;
    	const remove_icon_slot_template = /*#slots*/ ctx[53]["remove-icon"];
    	const remove_icon_slot = create_slot(remove_icon_slot_template, ctx, /*$$scope*/ ctx[75], get_remove_icon_slot_context);
    	const remove_icon_slot_or_fallback = remove_icon_slot || fallback_block_4();

    	function mouseup_handler() {
    		return /*mouseup_handler*/ ctx[59](/*option*/ ctx[78]);
    	}

    	function keydown_handler() {
    		return /*keydown_handler*/ ctx[60](/*option*/ ctx[78]);
    	}

    	return {
    		c() {
    			button = element("button");
    			if (remove_icon_slot_or_fallback) remove_icon_slot_or_fallback.c();
    			this.h();
    		},
    		l(nodes) {
    			button = claim_element(nodes, "BUTTON", { type: true, title: true, class: true });
    			var button_nodes = children(button);
    			if (remove_icon_slot_or_fallback) remove_icon_slot_or_fallback.l(button_nodes);
    			button_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(button, "type", "button");
    			attr(button, "title", button_title_value = "" + (/*removeBtnTitle*/ ctx[29] + " " + get_label(/*option*/ ctx[78])));
    			attr(button, "class", "svelte-cnxwog");
    		},
    		m(target, anchor) {
    			insert_hydration(target, button, anchor);

    			if (remove_icon_slot_or_fallback) {
    				remove_icon_slot_or_fallback.m(button, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(button, "mouseup", stop_propagation(mouseup_handler)),
    					listen(button, "keydown", function () {
    						if (is_function(/*if_enter_or_space*/ ctx[44](keydown_handler))) /*if_enter_or_space*/ ctx[44](keydown_handler).apply(this, arguments);
    					})
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (remove_icon_slot) {
    				if (remove_icon_slot.p && (!current || dirty[2] & /*$$scope*/ 8192)) {
    					update_slot_base(
    						remove_icon_slot,
    						remove_icon_slot_template,
    						ctx,
    						/*$$scope*/ ctx[75],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[75])
    						: get_slot_changes(remove_icon_slot_template, /*$$scope*/ ctx[75], dirty, get_remove_icon_slot_changes),
    						get_remove_icon_slot_context
    					);
    				}
    			}

    			if (!current || dirty[0] & /*removeBtnTitle, selected*/ 536870928 && button_title_value !== (button_title_value = "" + (/*removeBtnTitle*/ ctx[29] + " " + get_label(/*option*/ ctx[78])))) {
    				attr(button, "title", button_title_value);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(remove_icon_slot_or_fallback, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(remove_icon_slot_or_fallback, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			if (remove_icon_slot_or_fallback) remove_icon_slot_or_fallback.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (311:37) <CrossIcon width="15px" />
    function fallback_block_4(ctx) {
    	let crossicon;
    	let current;
    	crossicon = new Cross({ props: { width: "15px" } });

    	return {
    		c() {
    			create_component(crossicon.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(crossicon.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(crossicon, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(crossicon.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(crossicon.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(crossicon, detaching);
    		}
    	};
    }

    // (295:4) {#each selected as option, idx}
    function create_each_block_1(ctx) {
    	let li;
    	let t;
    	let li_class_value;
    	let current;
    	const selected_slot_template = /*#slots*/ ctx[53].selected;
    	const selected_slot = create_slot(selected_slot_template, ctx, /*$$scope*/ ctx[75], get_selected_slot_context);
    	const selected_slot_or_fallback = selected_slot || fallback_block_5(ctx);
    	let if_block = !/*disabled*/ ctx[33] && create_if_block_8(ctx);

    	return {
    		c() {
    			li = element("li");
    			if (selected_slot_or_fallback) selected_slot_or_fallback.c();
    			t = space();
    			if (if_block) if_block.c();
    			this.h();
    		},
    		l(nodes) {
    			li = claim_element(nodes, "LI", { class: true, "aria-selected": true });
    			var li_nodes = children(li);
    			if (selected_slot_or_fallback) selected_slot_or_fallback.l(li_nodes);
    			t = claim_space(li_nodes);
    			if (if_block) if_block.l(li_nodes);
    			li_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(li, "class", li_class_value = "" + (null_to_empty(/*liSelectedClass*/ ctx[19]) + " svelte-cnxwog"));
    			attr(li, "aria-selected", "true");
    		},
    		m(target, anchor) {
    			insert_hydration(target, li, anchor);

    			if (selected_slot_or_fallback) {
    				selected_slot_or_fallback.m(li, null);
    			}

    			append_hydration(li, t);
    			if (if_block) if_block.m(li, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (selected_slot) {
    				if (selected_slot.p && (!current || dirty[0] & /*selected*/ 16 | dirty[2] & /*$$scope*/ 8192)) {
    					update_slot_base(
    						selected_slot,
    						selected_slot_template,
    						ctx,
    						/*$$scope*/ ctx[75],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[75])
    						: get_slot_changes(selected_slot_template, /*$$scope*/ ctx[75], dirty, get_selected_slot_changes),
    						get_selected_slot_context
    					);
    				}
    			} else {
    				if (selected_slot_or_fallback && selected_slot_or_fallback.p && (!current || dirty[0] & /*selected, parseLabelsAsHtml*/ 67108880)) {
    					selected_slot_or_fallback.p(ctx, !current ? [-1, -1, -1] : dirty);
    				}
    			}

    			if (!/*disabled*/ ctx[33]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty[1] & /*disabled*/ 4) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block_8(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(li, null);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}

    			if (!current || dirty[0] & /*liSelectedClass*/ 524288 && li_class_value !== (li_class_value = "" + (null_to_empty(/*liSelectedClass*/ ctx[19]) + " svelte-cnxwog"))) {
    				attr(li, "class", li_class_value);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(selected_slot_or_fallback, local);
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(selected_slot_or_fallback, local);
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    			if (selected_slot_or_fallback) selected_slot_or_fallback.d(detaching);
    			if (if_block) if_block.d();
    		}
    	};
    }

    // (333:2) {#if loading}
    function create_if_block_7(ctx) {
    	let current;
    	const spinner_slot_template = /*#slots*/ ctx[53].spinner;
    	const spinner_slot = create_slot(spinner_slot_template, ctx, /*$$scope*/ ctx[75], get_spinner_slot_context);
    	const spinner_slot_or_fallback = spinner_slot || fallback_block_3();

    	return {
    		c() {
    			if (spinner_slot_or_fallback) spinner_slot_or_fallback.c();
    		},
    		l(nodes) {
    			if (spinner_slot_or_fallback) spinner_slot_or_fallback.l(nodes);
    		},
    		m(target, anchor) {
    			if (spinner_slot_or_fallback) {
    				spinner_slot_or_fallback.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (spinner_slot) {
    				if (spinner_slot.p && (!current || dirty[2] & /*$$scope*/ 8192)) {
    					update_slot_base(
    						spinner_slot,
    						spinner_slot_template,
    						ctx,
    						/*$$scope*/ ctx[75],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[75])
    						: get_slot_changes(spinner_slot_template, /*$$scope*/ ctx[75], dirty, get_spinner_slot_changes),
    						get_spinner_slot_context
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(spinner_slot_or_fallback, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(spinner_slot_or_fallback, local);
    			current = false;
    		},
    		d(detaching) {
    			if (spinner_slot_or_fallback) spinner_slot_or_fallback.d(detaching);
    		}
    	};
    }

    // (334:25)        
    function fallback_block_3(ctx) {
    	let circlespinner;
    	let current;
    	circlespinner = new CircleSpinner({});

    	return {
    		c() {
    			create_component(circlespinner.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(circlespinner.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(circlespinner, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(circlespinner.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(circlespinner.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(circlespinner, detaching);
    		}
    	};
    }

    // (342:32) 
    function create_if_block_4(ctx) {
    	let t;
    	let if_block1_anchor;
    	let current;
    	let if_block0 = /*maxSelect*/ ctx[21] && (/*maxSelect*/ ctx[21] > 1 || /*maxSelectMsg*/ ctx[22]) && create_if_block_6(ctx);
    	let if_block1 = /*maxSelect*/ ctx[21] !== 1 && /*selected*/ ctx[4].length > 1 && create_if_block_5(ctx);

    	return {
    		c() {
    			if (if_block0) if_block0.c();
    			t = space();
    			if (if_block1) if_block1.c();
    			if_block1_anchor = empty();
    		},
    		l(nodes) {
    			if (if_block0) if_block0.l(nodes);
    			t = claim_space(nodes);
    			if (if_block1) if_block1.l(nodes);
    			if_block1_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block0) if_block0.m(target, anchor);
    			insert_hydration(target, t, anchor);
    			if (if_block1) if_block1.m(target, anchor);
    			insert_hydration(target, if_block1_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (/*maxSelect*/ ctx[21] && (/*maxSelect*/ ctx[21] > 1 || /*maxSelectMsg*/ ctx[22])) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);

    					if (dirty[0] & /*maxSelect, maxSelectMsg*/ 6291456) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_6(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(t.parentNode, t);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			if (/*maxSelect*/ ctx[21] !== 1 && /*selected*/ ctx[4].length > 1) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);

    					if (dirty[0] & /*maxSelect, selected*/ 2097168) {
    						transition_in(if_block1, 1);
    					}
    				} else {
    					if_block1 = create_if_block_5(ctx);
    					if_block1.c();
    					transition_in(if_block1, 1);
    					if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
    				}
    			} else if (if_block1) {
    				group_outros();

    				transition_out(if_block1, 1, 1, () => {
    					if_block1 = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block0);
    			transition_in(if_block1);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block0);
    			transition_out(if_block1);
    			current = false;
    		},
    		d(detaching) {
    			if (if_block0) if_block0.d(detaching);
    			if (detaching) detach(t);
    			if (if_block1) if_block1.d(detaching);
    			if (detaching) detach(if_block1_anchor);
    		}
    	};
    }

    // (338:2) {#if disabled}
    function create_if_block_3(ctx) {
    	let current;
    	const disabled_icon_slot_template = /*#slots*/ ctx[53]["disabled-icon"];
    	const disabled_icon_slot = create_slot(disabled_icon_slot_template, ctx, /*$$scope*/ ctx[75], get_disabled_icon_slot_context);
    	const disabled_icon_slot_or_fallback = disabled_icon_slot || fallback_block_1();

    	return {
    		c() {
    			if (disabled_icon_slot_or_fallback) disabled_icon_slot_or_fallback.c();
    		},
    		l(nodes) {
    			if (disabled_icon_slot_or_fallback) disabled_icon_slot_or_fallback.l(nodes);
    		},
    		m(target, anchor) {
    			if (disabled_icon_slot_or_fallback) {
    				disabled_icon_slot_or_fallback.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (disabled_icon_slot) {
    				if (disabled_icon_slot.p && (!current || dirty[2] & /*$$scope*/ 8192)) {
    					update_slot_base(
    						disabled_icon_slot,
    						disabled_icon_slot_template,
    						ctx,
    						/*$$scope*/ ctx[75],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[75])
    						: get_slot_changes(disabled_icon_slot_template, /*$$scope*/ ctx[75], dirty, get_disabled_icon_slot_changes),
    						get_disabled_icon_slot_context
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(disabled_icon_slot_or_fallback, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(disabled_icon_slot_or_fallback, local);
    			current = false;
    		},
    		d(detaching) {
    			if (disabled_icon_slot_or_fallback) disabled_icon_slot_or_fallback.d(detaching);
    		}
    	};
    }

    // (343:4) {#if maxSelect && (maxSelect > 1 || maxSelectMsg)}
    function create_if_block_6(ctx) {
    	let wiggle_1;
    	let updating_wiggle;
    	let current;

    	function wiggle_1_wiggle_binding(value) {
    		/*wiggle_1_wiggle_binding*/ ctx[63](value);
    	}

    	let wiggle_1_props = {
    		angle: 20,
    		$$slots: { default: [create_default_slot$7] },
    		$$scope: { ctx }
    	};

    	if (/*wiggle*/ ctx[37] !== void 0) {
    		wiggle_1_props.wiggle = /*wiggle*/ ctx[37];
    	}

    	wiggle_1 = new Wiggle({ props: wiggle_1_props });
    	binding_callbacks.push(() => bind(wiggle_1, 'wiggle', wiggle_1_wiggle_binding));

    	return {
    		c() {
    			create_component(wiggle_1.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(wiggle_1.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(wiggle_1, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const wiggle_1_changes = {};

    			if (dirty[0] & /*maxSelectMsg, selected, maxSelect*/ 6291472 | dirty[2] & /*$$scope*/ 8192) {
    				wiggle_1_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_wiggle && dirty[1] & /*wiggle*/ 64) {
    				updating_wiggle = true;
    				wiggle_1_changes.wiggle = /*wiggle*/ ctx[37];
    				add_flush_callback(() => updating_wiggle = false);
    			}

    			wiggle_1.$set(wiggle_1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(wiggle_1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(wiggle_1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(wiggle_1, detaching);
    		}
    	};
    }

    // (344:6) <Wiggle bind:wiggle angle={20}>
    function create_default_slot$7(ctx) {
    	let span;

    	let t_value = (/*maxSelectMsg*/ ctx[22]?.(/*selected*/ ctx[4].length, /*maxSelect*/ ctx[21]) ?? (/*maxSelect*/ ctx[21] > 1
    	? `${/*selected*/ ctx[4].length}/${/*maxSelect*/ ctx[21]}`
    	: ``)) + "";

    	let t;

    	return {
    		c() {
    			span = element("span");
    			t = text(t_value);
    			this.h();
    		},
    		l(nodes) {
    			span = claim_element(nodes, "SPAN", { style: true, class: true });
    			var span_nodes = children(span);
    			t = claim_text(span_nodes, t_value);
    			span_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			set_style(span, "padding", "0 3pt");
    			attr(span, "class", "svelte-cnxwog");
    		},
    		m(target, anchor) {
    			insert_hydration(target, span, anchor);
    			append_hydration(span, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*maxSelectMsg, selected, maxSelect*/ 6291472 && t_value !== (t_value = (/*maxSelectMsg*/ ctx[22]?.(/*selected*/ ctx[4].length, /*maxSelect*/ ctx[21]) ?? (/*maxSelect*/ ctx[21] > 1
    			? `${/*selected*/ ctx[4].length}/${/*maxSelect*/ ctx[21]}`
    			: ``)) + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    		}
    	};
    }

    // (351:4) {#if maxSelect !== 1 && selected.length > 1}
    function create_if_block_5(ctx) {
    	let button;
    	let current;
    	let mounted;
    	let dispose;
    	const remove_icon_slot_template = /*#slots*/ ctx[53]["remove-icon"];
    	const remove_icon_slot = create_slot(remove_icon_slot_template, ctx, /*$$scope*/ ctx[75], get_remove_icon_slot_context_1);
    	const remove_icon_slot_or_fallback = remove_icon_slot || fallback_block_2();

    	return {
    		c() {
    			button = element("button");
    			if (remove_icon_slot_or_fallback) remove_icon_slot_or_fallback.c();
    			this.h();
    		},
    		l(nodes) {
    			button = claim_element(nodes, "BUTTON", { type: true, class: true, title: true });
    			var button_nodes = children(button);
    			if (remove_icon_slot_or_fallback) remove_icon_slot_or_fallback.l(button_nodes);
    			button_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(button, "type", "button");
    			attr(button, "class", "remove-all svelte-cnxwog");
    			attr(button, "title", /*removeAllTitle*/ ctx[28]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, button, anchor);

    			if (remove_icon_slot_or_fallback) {
    				remove_icon_slot_or_fallback.m(button, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(button, "mouseup", stop_propagation(/*remove_all*/ ctx[43])),
    					listen(button, "keydown", /*if_enter_or_space*/ ctx[44](/*remove_all*/ ctx[43]))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (remove_icon_slot) {
    				if (remove_icon_slot.p && (!current || dirty[2] & /*$$scope*/ 8192)) {
    					update_slot_base(
    						remove_icon_slot,
    						remove_icon_slot_template,
    						ctx,
    						/*$$scope*/ ctx[75],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[75])
    						: get_slot_changes(remove_icon_slot_template, /*$$scope*/ ctx[75], dirty, get_remove_icon_slot_changes_1),
    						get_remove_icon_slot_context_1
    					);
    				}
    			}

    			if (!current || dirty[0] & /*removeAllTitle*/ 268435456) {
    				attr(button, "title", /*removeAllTitle*/ ctx[28]);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(remove_icon_slot_or_fallback, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(remove_icon_slot_or_fallback, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			if (remove_icon_slot_or_fallback) remove_icon_slot_or_fallback.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (359:33) <CrossIcon width="15px" />
    function fallback_block_2(ctx) {
    	let crossicon;
    	let current;
    	crossicon = new Cross({ props: { width: "15px" } });

    	return {
    		c() {
    			create_component(crossicon.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(crossicon.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(crossicon, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(crossicon.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(crossicon.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(crossicon, detaching);
    		}
    	};
    }

    // (339:31)        
    function fallback_block_1(ctx) {
    	let disabledicon;
    	let current;
    	disabledicon = new Disabled({ props: { width: "15px" } });

    	return {
    		c() {
    			create_component(disabledicon.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(disabledicon.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(disabledicon, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(disabledicon.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(disabledicon.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(disabledicon, detaching);
    		}
    	};
    }

    // (365:2) {#if searchText || options?.length > 0}
    function create_if_block$2(ctx) {
    	let ul;
    	let ul_class_value;
    	let current;
    	let each_value = /*matchingOptions*/ ctx[1];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$2(get_each_context$2(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	let each_1_else = null;

    	if (!each_value.length) {
    		each_1_else = create_else_block_1$1(ctx);
    	}

    	return {
    		c() {
    			ul = element("ul");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			if (each_1_else) {
    				each_1_else.c();
    			}

    			this.h();
    		},
    		l(nodes) {
    			ul = claim_element(nodes, "UL", { class: true });
    			var ul_nodes = children(ul);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(ul_nodes);
    			}

    			if (each_1_else) {
    				each_1_else.l(ul_nodes);
    			}

    			ul_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(ul, "class", ul_class_value = "options " + /*ulOptionsClass*/ ctx[31] + " svelte-cnxwog");
    			toggle_class(ul, "hidden", !/*open*/ ctx[8]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, ul, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(ul, null);
    			}

    			if (each_1_else) {
    				each_1_else.m(ul, null);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*matchingOptions, liOptionClass, activeIndex, liActiveOptionClass, parseLabelsAsHtml, addOptionMsg, searchText, allowUserOptions, noOptionsMsg*/ 84282379 | dirty[1] & /*is_selected, remove, add, add_option_msg_is_active*/ 912 | dirty[2] & /*$$scope*/ 8192) {
    				each_value = /*matchingOptions*/ ctx[1];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$2(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block$2(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(ul, null);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();

    				if (!each_value.length && each_1_else) {
    					each_1_else.p(ctx, dirty);
    				} else if (!each_value.length) {
    					each_1_else = create_else_block_1$1(ctx);
    					each_1_else.c();
    					each_1_else.m(ul, null);
    				} else if (each_1_else) {
    					each_1_else.d(1);
    					each_1_else = null;
    				}
    			}

    			if (!current || dirty[1] & /*ulOptionsClass*/ 1 && ul_class_value !== (ul_class_value = "options " + /*ulOptionsClass*/ ctx[31] + " svelte-cnxwog")) {
    				attr(ul, "class", ul_class_value);
    			}

    			if (!current || dirty[0] & /*open*/ 256 | dirty[1] & /*ulOptionsClass*/ 1) {
    				toggle_class(ul, "hidden", !/*open*/ ctx[8]);
    			}
    		},
    		i(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(ul);
    			destroy_each(each_blocks, detaching);
    			if (each_1_else) each_1_else.d();
    		}
    	};
    }

    // (406:6) {:else}
    function create_else_block_1$1(ctx) {
    	let if_block_anchor;

    	function select_block_type_3(ctx, dirty) {
    		if (/*allowUserOptions*/ ctx[11] && /*searchText*/ ctx[3]) return create_if_block_2$1;
    		return create_else_block_2;
    	}

    	let current_block_type = select_block_type_3(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type_3(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (421:8) {:else}
    function create_else_block_2(ctx) {
    	let span;
    	let t;

    	return {
    		c() {
    			span = element("span");
    			t = text(/*noOptionsMsg*/ ctx[24]);
    			this.h();
    		},
    		l(nodes) {
    			span = claim_element(nodes, "SPAN", { class: true });
    			var span_nodes = children(span);
    			t = claim_text(span_nodes, /*noOptionsMsg*/ ctx[24]);
    			span_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(span, "class", "svelte-cnxwog");
    		},
    		m(target, anchor) {
    			insert_hydration(target, span, anchor);
    			append_hydration(span, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*noOptionsMsg*/ 16777216) set_data(t, /*noOptionsMsg*/ ctx[24]);
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    		}
    	};
    }

    // (407:8) {#if allowUserOptions && searchText}
    function create_if_block_2$1(ctx) {
    	let li;
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			li = element("li");
    			t0 = text(/*addOptionMsg*/ ctx[10]);
    			t1 = space();
    			this.h();
    		},
    		l(nodes) {
    			li = claim_element(nodes, "LI", {
    				title: true,
    				"aria-selected": true,
    				class: true
    			});

    			var li_nodes = children(li);
    			t0 = claim_text(li_nodes, /*addOptionMsg*/ ctx[10]);
    			t1 = claim_space(li_nodes);
    			li_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(li, "title", /*addOptionMsg*/ ctx[10]);
    			attr(li, "aria-selected", "false");
    			attr(li, "class", "svelte-cnxwog");
    			toggle_class(li, "active", /*add_option_msg_is_active*/ ctx[35]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, li, anchor);
    			append_hydration(li, t0);
    			append_hydration(li, t1);

    			if (!mounted) {
    				dispose = [
    					listen(li, "mousedown", stop_propagation(/*mousedown_handler_1*/ ctx[55])),
    					listen(li, "mouseup", stop_propagation(/*mouseup_handler_2*/ ctx[69])),
    					listen(li, "mouseover", /*mouseover_handler_1*/ ctx[70]),
    					listen(li, "focus", /*focus_handler_1*/ ctx[71]),
    					listen(li, "mouseout", /*mouseout_handler_1*/ ctx[72]),
    					listen(li, "blur", /*blur_handler_1*/ ctx[73])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*addOptionMsg*/ 1024) set_data(t0, /*addOptionMsg*/ ctx[10]);

    			if (dirty[0] & /*addOptionMsg*/ 1024) {
    				attr(li, "title", /*addOptionMsg*/ ctx[10]);
    			}

    			if (dirty[1] & /*add_option_msg_is_active*/ 16) {
    				toggle_class(li, "active", /*add_option_msg_is_active*/ ctx[35]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (401:12) {:else}
    function create_else_block$2(ctx) {
    	let t_value = get_label(/*option*/ ctx[78]) + "";
    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		l(nodes) {
    			t = claim_text(nodes, t_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*matchingOptions*/ 2 && t_value !== (t_value = get_label(/*option*/ ctx[78]) + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (399:12) {#if parseLabelsAsHtml}
    function create_if_block_1$1(ctx) {
    	let html_tag;
    	let raw_value = get_label(/*option*/ ctx[78]) + "";
    	let html_anchor;

    	return {
    		c() {
    			html_tag = new HtmlTagHydration(false);
    			html_anchor = empty();
    			this.h();
    		},
    		l(nodes) {
    			html_tag = claim_html_tag(nodes, false);
    			html_anchor = empty();
    			this.h();
    		},
    		h() {
    			html_tag.a = html_anchor;
    		},
    		m(target, anchor) {
    			html_tag.m(raw_value, target, anchor);
    			insert_hydration(target, html_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*matchingOptions*/ 2 && raw_value !== (raw_value = get_label(/*option*/ ctx[78]) + "")) html_tag.p(raw_value);
    		},
    		d(detaching) {
    			if (detaching) detach(html_anchor);
    			if (detaching) html_tag.d();
    		}
    	};
    }

    // (398:45)              
    function fallback_block(ctx) {
    	let if_block_anchor;

    	function select_block_type_2(ctx, dirty) {
    		if (/*parseLabelsAsHtml*/ ctx[26]) return create_if_block_1$1;
    		return create_else_block$2;
    	}

    	let current_block_type = select_block_type_2(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type_2(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (367:6) {#each matchingOptions as option, idx}
    function create_each_block$2(ctx) {
    	let li;
    	let t;
    	let li_title_value;
    	let li_class_value;
    	let current;
    	let mounted;
    	let dispose;
    	const option_slot_template = /*#slots*/ ctx[53].option;
    	const option_slot = create_slot(option_slot_template, ctx, /*$$scope*/ ctx[75], get_option_slot_context);
    	const option_slot_or_fallback = option_slot || fallback_block(ctx);

    	function mouseup_handler_1() {
    		return /*mouseup_handler_1*/ ctx[64](/*disabled*/ ctx[33], /*label*/ ctx[79]);
    	}

    	function mouseover_handler() {
    		return /*mouseover_handler*/ ctx[65](/*disabled*/ ctx[33], /*idx*/ ctx[85]);
    	}

    	function focus_handler() {
    		return /*focus_handler*/ ctx[66](/*disabled*/ ctx[33], /*idx*/ ctx[85]);
    	}

    	return {
    		c() {
    			li = element("li");
    			if (option_slot_or_fallback) option_slot_or_fallback.c();
    			t = space();
    			this.h();
    		},
    		l(nodes) {
    			li = claim_element(nodes, "LI", {
    				title: true,
    				class: true,
    				"aria-selected": true
    			});

    			var li_nodes = children(li);
    			if (option_slot_or_fallback) option_slot_or_fallback.l(li_nodes);
    			t = claim_space(li_nodes);
    			li_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(li, "title", li_title_value = /*disabled*/ ctx[33]
    			? /*disabledTitle*/ ctx[82]
    			: /*is_selected*/ ctx[38](/*label*/ ctx[79]) && /*selectedTitle*/ ctx[81] || /*title*/ ctx[80]);

    			attr(li, "class", li_class_value = "" + (/*liOptionClass*/ ctx[18] + " " + (/*active*/ ctx[83]
    			? /*liActiveOptionClass*/ ctx[17]
    			: ``) + " svelte-cnxwog"));

    			attr(li, "aria-selected", "false");
    			toggle_class(li, "selected", /*is_selected*/ ctx[38](/*label*/ ctx[79]));
    			toggle_class(li, "active", /*active*/ ctx[83]);
    			toggle_class(li, "disabled", /*disabled*/ ctx[33]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, li, anchor);

    			if (option_slot_or_fallback) {
    				option_slot_or_fallback.m(li, null);
    			}

    			append_hydration(li, t);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(li, "mousedown", stop_propagation(/*mousedown_handler*/ ctx[54])),
    					listen(li, "mouseup", stop_propagation(mouseup_handler_1)),
    					listen(li, "mouseover", mouseover_handler),
    					listen(li, "focus", focus_handler),
    					listen(li, "mouseout", /*mouseout_handler*/ ctx[67]),
    					listen(li, "blur", /*blur_handler*/ ctx[68])
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (option_slot) {
    				if (option_slot.p && (!current || dirty[0] & /*matchingOptions*/ 2 | dirty[2] & /*$$scope*/ 8192)) {
    					update_slot_base(
    						option_slot,
    						option_slot_template,
    						ctx,
    						/*$$scope*/ ctx[75],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[75])
    						: get_slot_changes(option_slot_template, /*$$scope*/ ctx[75], dirty, get_option_slot_changes),
    						get_option_slot_context
    					);
    				}
    			} else {
    				if (option_slot_or_fallback && option_slot_or_fallback.p && (!current || dirty[0] & /*matchingOptions, parseLabelsAsHtml*/ 67108866)) {
    					option_slot_or_fallback.p(ctx, !current ? [-1, -1, -1] : dirty);
    				}
    			}

    			if (!current || dirty[0] & /*matchingOptions*/ 2 | dirty[1] & /*is_selected*/ 128 && li_title_value !== (li_title_value = /*disabled*/ ctx[33]
    			? /*disabledTitle*/ ctx[82]
    			: /*is_selected*/ ctx[38](/*label*/ ctx[79]) && /*selectedTitle*/ ctx[81] || /*title*/ ctx[80])) {
    				attr(li, "title", li_title_value);
    			}

    			if (!current || dirty[0] & /*liOptionClass, activeIndex, liActiveOptionClass*/ 393217 && li_class_value !== (li_class_value = "" + (/*liOptionClass*/ ctx[18] + " " + (/*active*/ ctx[83]
    			? /*liActiveOptionClass*/ ctx[17]
    			: ``) + " svelte-cnxwog"))) {
    				attr(li, "class", li_class_value);
    			}

    			if (!current || dirty[0] & /*liOptionClass, activeIndex, liActiveOptionClass, matchingOptions*/ 393219 | dirty[1] & /*is_selected*/ 128) {
    				toggle_class(li, "selected", /*is_selected*/ ctx[38](/*label*/ ctx[79]));
    			}

    			if (!current || dirty[0] & /*liOptionClass, activeIndex, liActiveOptionClass, activeIndex*/ 393217) {
    				toggle_class(li, "active", /*active*/ ctx[83]);
    			}

    			if (!current || dirty[0] & /*liOptionClass, activeIndex, liActiveOptionClass, matchingOptions*/ 393219) {
    				toggle_class(li, "disabled", /*disabled*/ ctx[33]);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(option_slot_or_fallback, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(option_slot_or_fallback, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    			if (option_slot_or_fallback) option_slot_or_fallback.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$c(ctx) {
    	let div;
    	let input0;
    	let t0;
    	let expandicon;
    	let t1;
    	let ul;
    	let t2;
    	let li;
    	let input1;
    	let input1_class_value;
    	let input1_placeholder_value;
    	let input1_aria_invalid_value;
    	let ul_class_value;
    	let t3;
    	let t4;
    	let current_block_type_index;
    	let if_block1;
    	let t5;
    	let div_aria_multiselectable_value;
    	let div_class_value;
    	let div_title_value;
    	let div_aria_disabled_value;
    	let current;
    	let mounted;
    	let dispose;
    	add_render_callback(/*onwindowresize*/ ctx[56]);

    	expandicon = new ChevronExpand({
    			props: {
    				width: "15px",
    				style: "min-width: 1em; padding: 0 1pt;"
    			}
    		});

    	let each_value_1 = /*selected*/ ctx[4];
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	let if_block0 = /*loading*/ ctx[20] && create_if_block_7(ctx);
    	const if_block_creators = [create_if_block_3, create_if_block_4];
    	const if_blocks = [];

    	function select_block_type_1(ctx, dirty) {
    		if (/*disabled*/ ctx[33]) return 0;
    		if (/*selected*/ ctx[4].length > 0) return 1;
    		return -1;
    	}

    	if (~(current_block_type_index = select_block_type_1(ctx))) {
    		if_block1 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	}

    	let if_block2 = (/*searchText*/ ctx[3] || /*options*/ ctx[2]?.length > 0) && create_if_block$2(ctx);

    	return {
    		c() {
    			div = element("div");
    			input0 = element("input");
    			t0 = space();
    			create_component(expandicon.$$.fragment);
    			t1 = space();
    			ul = element("ul");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t2 = space();
    			li = element("li");
    			input1 = element("input");
    			t3 = space();
    			if (if_block0) if_block0.c();
    			t4 = space();
    			if (if_block1) if_block1.c();
    			t5 = space();
    			if (if_block2) if_block2.c();
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", {
    				"aria-expanded": true,
    				"aria-multiselectable": true,
    				class: true,
    				title: true,
    				"aria-disabled": true
    			});

    			var div_nodes = children(div);

    			input0 = claim_element(div_nodes, "INPUT", {
    				tabindex: true,
    				"aria-hidden": true,
    				"aria-label": true,
    				class: true
    			});

    			t0 = claim_space(div_nodes);
    			claim_component(expandicon.$$.fragment, div_nodes);
    			t1 = claim_space(div_nodes);
    			ul = claim_element(div_nodes, "UL", { class: true });
    			var ul_nodes = children(ul);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(ul_nodes);
    			}

    			t2 = claim_space(ul_nodes);
    			li = claim_element(ul_nodes, "LI", { style: true, class: true });
    			var li_nodes = children(li);

    			input1 = claim_element(li_nodes, "INPUT", {
    				class: true,
    				autocomplete: true,
    				id: true,
    				name: true,
    				placeholder: true,
    				"aria-invalid": true
    			});

    			li_nodes.forEach(detach);
    			ul_nodes.forEach(detach);
    			t3 = claim_space(div_nodes);
    			if (if_block0) if_block0.l(div_nodes);
    			t4 = claim_space(div_nodes);
    			if (if_block1) if_block1.l(div_nodes);
    			t5 = claim_space(div_nodes);
    			if (if_block2) if_block2.l(div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			input0.required = /*required*/ ctx[30];
    			attr(input0, "tabindex", "-1");
    			attr(input0, "aria-hidden", "true");
    			attr(input0, "aria-label", "ignore this, used only to prevent form submission if select is required but empty");
    			attr(input0, "class", "form-control svelte-cnxwog");
    			attr(input1, "class", input1_class_value = "" + (null_to_empty(/*inputClass*/ ctx[16]) + " svelte-cnxwog"));
    			attr(input1, "autocomplete", /*autocomplete*/ ctx[12]);
    			attr(input1, "id", /*id*/ ctx[15]);
    			attr(input1, "name", /*name*/ ctx[23]);
    			input1.disabled = /*disabled*/ ctx[33];

    			attr(input1, "placeholder", input1_placeholder_value = /*selectedLabels*/ ctx[5].length
    			? ``
    			: /*placeholder*/ ctx[27]);

    			attr(input1, "aria-invalid", input1_aria_invalid_value = /*invalid*/ ctx[7] ? `true` : null);
    			set_style(li, "display", "contents");
    			attr(li, "class", "svelte-cnxwog");
    			attr(ul, "class", ul_class_value = "selected " + /*ulSelectedClass*/ ctx[32] + " svelte-cnxwog");
    			attr(div, "aria-expanded", /*open*/ ctx[8]);
    			attr(div, "aria-multiselectable", div_aria_multiselectable_value = /*maxSelect*/ ctx[21] === null || /*maxSelect*/ ctx[21] > 1);
    			attr(div, "class", div_class_value = "multiselect " + /*outerDivClass*/ ctx[25] + " svelte-cnxwog");

    			attr(div, "title", div_title_value = /*disabled*/ ctx[33]
    			? /*disabledInputTitle*/ ctx[14]
    			: null);

    			attr(div, "aria-disabled", div_aria_disabled_value = /*disabled*/ ctx[33] ? `true` : null);
    			toggle_class(div, "disabled", /*disabled*/ ctx[33]);
    			toggle_class(div, "single", /*maxSelect*/ ctx[21] === 1);
    			toggle_class(div, "open", /*open*/ ctx[8]);
    			toggle_class(div, "invalid", /*invalid*/ ctx[7]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			append_hydration(div, input0);
    			set_input_value(input0, /*formValue*/ ctx[34]);
    			append_hydration(div, t0);
    			mount_component(expandicon, div, null);
    			append_hydration(div, t1);
    			append_hydration(div, ul);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(ul, null);
    			}

    			append_hydration(ul, t2);
    			append_hydration(ul, li);
    			append_hydration(li, input1);
    			/*input1_binding*/ ctx[61](input1);
    			set_input_value(input1, /*searchText*/ ctx[3]);
    			append_hydration(div, t3);
    			if (if_block0) if_block0.m(div, null);
    			append_hydration(div, t4);

    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].m(div, null);
    			}

    			append_hydration(div, t5);
    			if (if_block2) if_block2.m(div, null);
    			/*div_binding*/ ctx[74](div);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(window, "click", /*on_click_outside*/ ctx[45]),
    					listen(window, "touchstart", /*on_click_outside*/ ctx[45]),
    					listen(window, "resize", /*onwindowresize*/ ctx[56]),
    					listen(input0, "input", /*input0_input_handler*/ ctx[57]),
    					listen(input0, "invalid", /*invalid_handler*/ ctx[58]),
    					listen(input1, "input", /*input1_input_handler*/ ctx[62]),
    					listen(input1, "mouseup", self(stop_propagation(/*open_dropdown*/ ctx[41]))),
    					listen(input1, "keydown", /*handle_keydown*/ ctx[42]),
    					listen(input1, "focus", /*open_dropdown*/ ctx[41]),
    					listen(div, "mouseup", stop_propagation(/*open_dropdown*/ ctx[41]))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (!current || dirty[0] & /*required*/ 1073741824) {
    				input0.required = /*required*/ ctx[30];
    			}

    			if (dirty[1] & /*formValue*/ 8 && input0.value !== /*formValue*/ ctx[34]) {
    				set_input_value(input0, /*formValue*/ ctx[34]);
    			}

    			if (dirty[0] & /*liSelectedClass, removeBtnTitle, selected, parseLabelsAsHtml*/ 604504080 | dirty[1] & /*remove, if_enter_or_space, disabled*/ 8708 | dirty[2] & /*$$scope*/ 8192) {
    				each_value_1 = /*selected*/ ctx[4];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block_1(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(ul, t2);
    					}
    				}

    				group_outros();

    				for (i = each_value_1.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}

    			if (!current || dirty[0] & /*inputClass*/ 65536 && input1_class_value !== (input1_class_value = "" + (null_to_empty(/*inputClass*/ ctx[16]) + " svelte-cnxwog"))) {
    				attr(input1, "class", input1_class_value);
    			}

    			if (!current || dirty[0] & /*autocomplete*/ 4096) {
    				attr(input1, "autocomplete", /*autocomplete*/ ctx[12]);
    			}

    			if (!current || dirty[0] & /*id*/ 32768) {
    				attr(input1, "id", /*id*/ ctx[15]);
    			}

    			if (!current || dirty[0] & /*name*/ 8388608) {
    				attr(input1, "name", /*name*/ ctx[23]);
    			}

    			if (!current || dirty[1] & /*disabled*/ 4) {
    				input1.disabled = /*disabled*/ ctx[33];
    			}

    			if (!current || dirty[0] & /*selectedLabels, placeholder*/ 134217760 && input1_placeholder_value !== (input1_placeholder_value = /*selectedLabels*/ ctx[5].length
    			? ``
    			: /*placeholder*/ ctx[27])) {
    				attr(input1, "placeholder", input1_placeholder_value);
    			}

    			if (!current || dirty[0] & /*invalid*/ 128 && input1_aria_invalid_value !== (input1_aria_invalid_value = /*invalid*/ ctx[7] ? `true` : null)) {
    				attr(input1, "aria-invalid", input1_aria_invalid_value);
    			}

    			if (dirty[0] & /*searchText*/ 8 && input1.value !== /*searchText*/ ctx[3]) {
    				set_input_value(input1, /*searchText*/ ctx[3]);
    			}

    			if (!current || dirty[1] & /*ulSelectedClass*/ 2 && ul_class_value !== (ul_class_value = "selected " + /*ulSelectedClass*/ ctx[32] + " svelte-cnxwog")) {
    				attr(ul, "class", ul_class_value);
    			}

    			if (/*loading*/ ctx[20]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);

    					if (dirty[0] & /*loading*/ 1048576) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_7(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(div, t4);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type_1(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if (~current_block_type_index) {
    					if_blocks[current_block_type_index].p(ctx, dirty);
    				}
    			} else {
    				if (if_block1) {
    					group_outros();

    					transition_out(if_blocks[previous_block_index], 1, 1, () => {
    						if_blocks[previous_block_index] = null;
    					});

    					check_outros();
    				}

    				if (~current_block_type_index) {
    					if_block1 = if_blocks[current_block_type_index];

    					if (!if_block1) {
    						if_block1 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    						if_block1.c();
    					} else {
    						if_block1.p(ctx, dirty);
    					}

    					transition_in(if_block1, 1);
    					if_block1.m(div, t5);
    				} else {
    					if_block1 = null;
    				}
    			}

    			if (/*searchText*/ ctx[3] || /*options*/ ctx[2]?.length > 0) {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);

    					if (dirty[0] & /*searchText, options*/ 12) {
    						transition_in(if_block2, 1);
    					}
    				} else {
    					if_block2 = create_if_block$2(ctx);
    					if_block2.c();
    					transition_in(if_block2, 1);
    					if_block2.m(div, null);
    				}
    			} else if (if_block2) {
    				group_outros();

    				transition_out(if_block2, 1, 1, () => {
    					if_block2 = null;
    				});

    				check_outros();
    			}

    			if (!current || dirty[0] & /*open*/ 256) {
    				attr(div, "aria-expanded", /*open*/ ctx[8]);
    			}

    			if (!current || dirty[0] & /*maxSelect*/ 2097152 && div_aria_multiselectable_value !== (div_aria_multiselectable_value = /*maxSelect*/ ctx[21] === null || /*maxSelect*/ ctx[21] > 1)) {
    				attr(div, "aria-multiselectable", div_aria_multiselectable_value);
    			}

    			if (!current || dirty[0] & /*outerDivClass*/ 33554432 && div_class_value !== (div_class_value = "multiselect " + /*outerDivClass*/ ctx[25] + " svelte-cnxwog")) {
    				attr(div, "class", div_class_value);
    			}

    			if (!current || dirty[0] & /*disabledInputTitle*/ 16384 | dirty[1] & /*disabled*/ 4 && div_title_value !== (div_title_value = /*disabled*/ ctx[33]
    			? /*disabledInputTitle*/ ctx[14]
    			: null)) {
    				attr(div, "title", div_title_value);
    			}

    			if (!current || dirty[1] & /*disabled*/ 4 && div_aria_disabled_value !== (div_aria_disabled_value = /*disabled*/ ctx[33] ? `true` : null)) {
    				attr(div, "aria-disabled", div_aria_disabled_value);
    			}

    			if (!current || dirty[0] & /*outerDivClass*/ 33554432 | dirty[1] & /*disabled*/ 4) {
    				toggle_class(div, "disabled", /*disabled*/ ctx[33]);
    			}

    			if (!current || dirty[0] & /*outerDivClass, maxSelect*/ 35651584) {
    				toggle_class(div, "single", /*maxSelect*/ ctx[21] === 1);
    			}

    			if (!current || dirty[0] & /*outerDivClass, open*/ 33554688) {
    				toggle_class(div, "open", /*open*/ ctx[8]);
    			}

    			if (!current || dirty[0] & /*outerDivClass, invalid*/ 33554560) {
    				toggle_class(div, "invalid", /*invalid*/ ctx[7]);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(expandicon.$$.fragment, local);

    			for (let i = 0; i < each_value_1.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			transition_in(if_block0);
    			transition_in(if_block1);
    			transition_in(if_block2);
    			current = true;
    		},
    		o(local) {
    			transition_out(expandicon.$$.fragment, local);
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			transition_out(if_block0);
    			transition_out(if_block1);
    			transition_out(if_block2);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(expandicon);
    			destroy_each(each_blocks, detaching);
    			/*input1_binding*/ ctx[61](null);
    			if (if_block0) if_block0.d();

    			if (~current_block_type_index) {
    				if_blocks[current_block_type_index].d();
    			}

    			if (if_block2) if_block2.d();
    			/*div_binding*/ ctx[74](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$7($$self, $$props, $$invalidate) {
    	let formValue;
    	let is_selected;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { activeIndex = null } = $$props;
    	let { activeOption = null } = $$props;
    	let { addOptionMsg = `Create this option...` } = $$props;
    	let { allowUserOptions = false } = $$props;
    	let { autocomplete = `off` } = $$props;
    	let { autoScroll = true } = $$props;
    	let { breakpoint = 800 } = $$props;
    	let { defaultDisabledTitle = `This option is disabled` } = $$props;
    	let { disabled = false } = $$props;
    	let { disabledInputTitle = `This input is disabled` } = $$props;

    	let { filterFunc = (op, searchText) => {
    		if (!searchText) return true;
    		return `${get_label(op)}`.toLowerCase().includes(searchText.toLowerCase());
    	} } = $$props;

    	let { focusInputOnSelect = `desktop` } = $$props;
    	let { id = null } = $$props;
    	let { input = null } = $$props;
    	let { inputClass = `` } = $$props;
    	let { invalid = false } = $$props;
    	let { liActiveOptionClass = `` } = $$props;
    	let { liOptionClass = `` } = $$props;
    	let { liSelectedClass = `` } = $$props;
    	let { loading = false } = $$props;
    	let { matchingOptions = [] } = $$props;
    	let { maxSelect = null } = $$props;
    	let { maxSelectMsg = null } = $$props;
    	let { name = null } = $$props;
    	let { noOptionsMsg = `No matching options` } = $$props;
    	let { open = false } = $$props;
    	let { options } = $$props;
    	let { outerDiv = null } = $$props;
    	let { outerDivClass = `` } = $$props;
    	let { parseLabelsAsHtml = false } = $$props;
    	let { placeholder = null } = $$props;
    	let { removeAllTitle = `Remove all` } = $$props;
    	let { removeBtnTitle = `Remove` } = $$props;
    	let { required = false } = $$props;
    	let { searchText = `` } = $$props;
    	let { selected = options?.filter(op => op?.preselected) ?? [] } = $$props;
    	let { selectedLabels = [] } = $$props;
    	let { selectedValues = [] } = $$props;
    	let { sortSelected = false } = $$props;
    	let { ulOptionsClass = `` } = $$props;
    	let { ulSelectedClass = `` } = $$props;

    	if (!(options?.length > 0)) {
    		if (allowUserOptions) {
    			options = []; // initializing as array avoids errors when component mounts
    		} else {
    			// only error for empty options if user is not allowed to create custom options
    			console.error(`MultiSelect received no options`);
    		}
    	}

    	if (parseLabelsAsHtml && allowUserOptions) {
    		console.warn(`Don't combine parseLabelsAsHtml and allowUserOptions. It's susceptible to XSS attacks!`);
    	}

    	if (maxSelect !== null && maxSelect < 1) {
    		console.error(`maxSelect must be null or positive integer, got ${maxSelect}`);
    	}

    	if (!Array.isArray(selected)) {
    		console.error(`selected prop must be an array, got ${selected}`);
    	}

    	const dispatch = createEventDispatcher();
    	let add_option_msg_is_active = false; // controls active state of <li>{addOptionMsg}</li>
    	let window_width;
    	let wiggle = false; // controls wiggle animation when user tries to exceed maxSelect

    	// raise if matchingOptions[activeIndex] does not yield a value
    	if (activeIndex !== null && !matchingOptions[activeIndex]) {
    		throw `Run time error, activeIndex=${activeIndex} is out of bounds, matchingOptions.length=${matchingOptions.length}`;
    	}

    	// add an option to selected list
    	function add(label) {
    		if (maxSelect && maxSelect > 1 && selected.length >= maxSelect) $$invalidate(37, wiggle = true);

    		// to prevent duplicate selection, we could add `&& !selectedLabels.includes(label)`
    		if (maxSelect === null || maxSelect === 1 || selected.length < maxSelect) {
    			// first check if we find option in the options list
    			let option = options.find(op => get_label(op) === label);

    			if (!option && // this has the side-effect of not allowing to user to add the same
    			// custom option twice in append mode
    			[true, `append`].includes(allowUserOptions) && searchText.length > 0) {
    				// user entered text but no options match, so if allowUserOptions=true | 'append', we create
    				// a new option from the user-entered text
    				if (typeof options[0] === `object`) {
    					// if 1st option is an object, we create new option as object to keep type homogeneity
    					option = { label: searchText, value: searchText };
    				} else {
    					if ([`number`, `undefined`].includes(typeof options[0]) && !isNaN(Number(searchText))) {
    						// create new option as number if it parses to a number and 1st option is also number or missing
    						option = Number(searchText);
    					} else option = searchText; // else create custom option as string
    				}

    				if (allowUserOptions === `append`) $$invalidate(2, options = [...options, option]);
    			}

    			$$invalidate(3, searchText = ``); // reset search string on selection

    			if (!option) {
    				console.error(`MultiSelect: option with label ${label} not found`);
    				return;
    			}

    			if (maxSelect === 1) {
    				// for maxselect = 1 we always replace current option with new one
    				$$invalidate(4, selected = [option]);
    			} else {
    				$$invalidate(4, selected = [...selected, option]);

    				if (sortSelected === true) {
    					$$invalidate(4, selected = selected.sort((op1, op2) => {
    						const [label1, label2] = [get_label(op1), get_label(op2)];

    						// coerce to string if labels are numbers
    						return `${label1}`.localeCompare(`${label2}`);
    					}));
    				} else if (typeof sortSelected === `function`) {
    					$$invalidate(4, selected = selected.sort(sortSelected));
    				}
    			}

    			if (selected.length === maxSelect) close_dropdown(); else if (focusInputOnSelect === true || focusInputOnSelect === `desktop` && window_width > breakpoint) {
    				input?.focus();
    			}

    			dispatch(`add`, { option });
    			dispatch(`change`, { option, type: `add` });
    		}
    	}

    	// remove an option from selected list
    	function remove(label) {
    		if (selected.length === 0) return;
    		selected.splice(selectedLabels.lastIndexOf(label), 1);
    		$$invalidate(4, selected); // Svelte rerender after in-place splice

    		const option = options.find(option => get_label(option) === label) ?? (// if option with label could not be found but allowUserOptions is truthy,
    		// assume it was created by user and create correspondidng option object
    		// on the fly for use as event payload
    		allowUserOptions && { label, value: label });

    		if (!option) {
    			return console.error(`MultiSelect: option with label ${label} not found`);
    		}

    		dispatch(`remove`, { option });
    		dispatch(`change`, { option, type: `remove` });
    	}

    	function open_dropdown() {
    		if (disabled) return;
    		$$invalidate(8, open = true);
    		input?.focus();
    		dispatch(`focus`);
    	}

    	function close_dropdown() {
    		$$invalidate(8, open = false);
    		input?.blur();
    		$$invalidate(47, activeOption = null);
    		dispatch(`blur`);
    	}

    	// handle all keyboard events this component receives
    	async function handle_keydown(event) {
    		// on escape or tab out of input: dismiss options dropdown and reset search text
    		if (event.key === `Escape` || event.key === `Tab`) {
    			close_dropdown();
    			$$invalidate(3, searchText = ``);
    		} else // on enter key: toggle active option and reset search text
    		if (event.key === `Enter`) {
    			event.preventDefault(); // prevent enter key from triggering form submission

    			if (activeOption) {
    				const label = get_label(activeOption);

    				selectedLabels.includes(label)
    				? remove(label)
    				: add(label);

    				$$invalidate(3, searchText = ``);
    			} else if (allowUserOptions && searchText.length > 0) {
    				// user entered text but no options match, so if allowUserOptions is truthy, we create new option
    				add(searchText);
    			} else // no active option and no search text means the options dropdown is closed
    			// in which case enter means open it
    			open_dropdown();
    		} else // on up/down arrow keys: update active option
    		if ([`ArrowDown`, `ArrowUp`].includes(event.key)) {
    			// if no option is active yet, but there are matching options, make first one active
    			if (activeIndex === null && matchingOptions.length > 0) {
    				$$invalidate(0, activeIndex = 0);
    				return;
    			} else if (allowUserOptions && searchText.length > 0) {
    				// if allowUserOptions is truthy and user entered text but no options match, we make
    				// <li>{addUserMsg}</li> active on keydown (or toggle it if already active)
    				$$invalidate(35, add_option_msg_is_active = !add_option_msg_is_active);

    				return;
    			} else if (activeIndex === null) {
    				// if no option is active and no options are matching, do nothing
    				return;
    			}

    			const increment = event.key === `ArrowUp` ? -1 : 1;
    			$$invalidate(0, activeIndex = (activeIndex + increment) % matchingOptions.length);

    			// % in JS behaves like remainder operator, not real modulo, so negative numbers stay negative
    			// need to do manual wrap around at 0
    			if (activeIndex < 0) $$invalidate(0, activeIndex = matchingOptions.length - 1);

    			if (autoScroll) {
    				// TODO This ugly timeout hack is needed to properly scroll element into view when wrapping
    				// around start/end of option list. Find a better solution than waiting 10 ms to.
    				setTimeout(
    					() => {
    						const li = document.querySelector(`ul.options > li.active`);

    						if (li) {
    							li.parentNode?.scrollIntoView({ block: `center` });
    							li.scrollIntoViewIfNeeded();
    						}
    					},
    					10
    				);
    			}
    		} else // on backspace key: remove last selected option
    		if (event.key === `Backspace` && selectedLabels.length > 0 && !searchText) {
    			remove(selectedLabels.at(-1));
    		}
    	}

    	function remove_all() {
    		dispatch(`removeAll`, { options: selected });
    		dispatch(`change`, { options: selected, type: `removeAll` });
    		$$invalidate(4, selected = []);
    		$$invalidate(3, searchText = ``);
    	}

    	const if_enter_or_space = handler => event => {
    		if ([`Enter`, `Space`].includes(event.code)) {
    			event.preventDefault();
    			handler();
    		}
    	};

    	function on_click_outside(event) {
    		if (outerDiv && !outerDiv.contains(event.target)) {
    			close_dropdown();
    		}
    	}

    	function mousedown_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function mousedown_handler_1(event) {
    		bubble.call(this, $$self, event);
    	}

    	function onwindowresize() {
    		$$invalidate(36, window_width = window.innerWidth);
    	}

    	function input0_input_handler() {
    		formValue = this.value;
    		(($$invalidate(34, formValue), $$invalidate(46, selectedValues)), $$invalidate(4, selected));
    	}

    	const invalid_handler = () => $$invalidate(7, invalid = true);
    	const mouseup_handler = option => remove(get_label(option));
    	const keydown_handler = option => remove(get_label(option));

    	function input1_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			input = $$value;
    			$$invalidate(6, input);
    		});
    	}

    	function input1_input_handler() {
    		searchText = this.value;
    		$$invalidate(3, searchText);
    	}

    	function wiggle_1_wiggle_binding(value) {
    		wiggle = value;
    		$$invalidate(37, wiggle);
    	}

    	const mouseup_handler_1 = (disabled, label) => {
    		if (!disabled) is_selected(label) ? remove(label) : add(label);
    	};

    	const mouseover_handler = (disabled, idx) => {
    		if (!disabled) $$invalidate(0, activeIndex = idx);
    	};

    	const focus_handler = (disabled, idx) => {
    		if (!disabled) $$invalidate(0, activeIndex = idx);
    	};

    	const mouseout_handler = () => $$invalidate(0, activeIndex = null);
    	const blur_handler = () => $$invalidate(0, activeIndex = null);
    	const mouseup_handler_2 = () => add(searchText);
    	const mouseover_handler_1 = () => $$invalidate(35, add_option_msg_is_active = true);
    	const focus_handler_1 = () => $$invalidate(35, add_option_msg_is_active = true);
    	const mouseout_handler_1 = () => $$invalidate(35, add_option_msg_is_active = false);
    	const blur_handler_1 = () => $$invalidate(35, add_option_msg_is_active = false);

    	function div_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			outerDiv = $$value;
    			$$invalidate(9, outerDiv);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('activeIndex' in $$props) $$invalidate(0, activeIndex = $$props.activeIndex);
    		if ('activeOption' in $$props) $$invalidate(47, activeOption = $$props.activeOption);
    		if ('addOptionMsg' in $$props) $$invalidate(10, addOptionMsg = $$props.addOptionMsg);
    		if ('allowUserOptions' in $$props) $$invalidate(11, allowUserOptions = $$props.allowUserOptions);
    		if ('autocomplete' in $$props) $$invalidate(12, autocomplete = $$props.autocomplete);
    		if ('autoScroll' in $$props) $$invalidate(48, autoScroll = $$props.autoScroll);
    		if ('breakpoint' in $$props) $$invalidate(49, breakpoint = $$props.breakpoint);
    		if ('defaultDisabledTitle' in $$props) $$invalidate(13, defaultDisabledTitle = $$props.defaultDisabledTitle);
    		if ('disabled' in $$props) $$invalidate(33, disabled = $$props.disabled);
    		if ('disabledInputTitle' in $$props) $$invalidate(14, disabledInputTitle = $$props.disabledInputTitle);
    		if ('filterFunc' in $$props) $$invalidate(50, filterFunc = $$props.filterFunc);
    		if ('focusInputOnSelect' in $$props) $$invalidate(51, focusInputOnSelect = $$props.focusInputOnSelect);
    		if ('id' in $$props) $$invalidate(15, id = $$props.id);
    		if ('input' in $$props) $$invalidate(6, input = $$props.input);
    		if ('inputClass' in $$props) $$invalidate(16, inputClass = $$props.inputClass);
    		if ('invalid' in $$props) $$invalidate(7, invalid = $$props.invalid);
    		if ('liActiveOptionClass' in $$props) $$invalidate(17, liActiveOptionClass = $$props.liActiveOptionClass);
    		if ('liOptionClass' in $$props) $$invalidate(18, liOptionClass = $$props.liOptionClass);
    		if ('liSelectedClass' in $$props) $$invalidate(19, liSelectedClass = $$props.liSelectedClass);
    		if ('loading' in $$props) $$invalidate(20, loading = $$props.loading);
    		if ('matchingOptions' in $$props) $$invalidate(1, matchingOptions = $$props.matchingOptions);
    		if ('maxSelect' in $$props) $$invalidate(21, maxSelect = $$props.maxSelect);
    		if ('maxSelectMsg' in $$props) $$invalidate(22, maxSelectMsg = $$props.maxSelectMsg);
    		if ('name' in $$props) $$invalidate(23, name = $$props.name);
    		if ('noOptionsMsg' in $$props) $$invalidate(24, noOptionsMsg = $$props.noOptionsMsg);
    		if ('open' in $$props) $$invalidate(8, open = $$props.open);
    		if ('options' in $$props) $$invalidate(2, options = $$props.options);
    		if ('outerDiv' in $$props) $$invalidate(9, outerDiv = $$props.outerDiv);
    		if ('outerDivClass' in $$props) $$invalidate(25, outerDivClass = $$props.outerDivClass);
    		if ('parseLabelsAsHtml' in $$props) $$invalidate(26, parseLabelsAsHtml = $$props.parseLabelsAsHtml);
    		if ('placeholder' in $$props) $$invalidate(27, placeholder = $$props.placeholder);
    		if ('removeAllTitle' in $$props) $$invalidate(28, removeAllTitle = $$props.removeAllTitle);
    		if ('removeBtnTitle' in $$props) $$invalidate(29, removeBtnTitle = $$props.removeBtnTitle);
    		if ('required' in $$props) $$invalidate(30, required = $$props.required);
    		if ('searchText' in $$props) $$invalidate(3, searchText = $$props.searchText);
    		if ('selected' in $$props) $$invalidate(4, selected = $$props.selected);
    		if ('selectedLabels' in $$props) $$invalidate(5, selectedLabels = $$props.selectedLabels);
    		if ('selectedValues' in $$props) $$invalidate(46, selectedValues = $$props.selectedValues);
    		if ('sortSelected' in $$props) $$invalidate(52, sortSelected = $$props.sortSelected);
    		if ('ulOptionsClass' in $$props) $$invalidate(31, ulOptionsClass = $$props.ulOptionsClass);
    		if ('ulSelectedClass' in $$props) $$invalidate(32, ulSelectedClass = $$props.ulSelectedClass);
    		if ('$$scope' in $$props) $$invalidate(75, $$scope = $$props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty[0] & /*selected*/ 16) {
    			$$invalidate(5, selectedLabels = selected.map(get_label));
    		}

    		if ($$self.$$.dirty[0] & /*selected*/ 16) {
    			$$invalidate(46, selectedValues = selected.map(get_value));
    		}

    		if ($$self.$$.dirty[1] & /*selectedValues*/ 32768) {
    			// formValue binds to input.form-control to prevent form submission if required
    			// prop is true and no options are selected
    			$$invalidate(34, formValue = selectedValues.join(`,`));
    		}

    		if ($$self.$$.dirty[1] & /*formValue*/ 8) {
    			if (formValue) $$invalidate(7, invalid = false); // reset error status whenever component state changes
    		}

    		if ($$self.$$.dirty[0] & /*options, searchText, selectedLabels*/ 44 | $$self.$$.dirty[1] & /*filterFunc*/ 524288) {
    			// options matching the current search text
    			$$invalidate(1, matchingOptions = options.filter(op => filterFunc(op, searchText) && !selectedLabels.includes(get_label(op)))); // remove already selected options from dropdown list
    		}

    		if ($$self.$$.dirty[0] & /*activeIndex, matchingOptions*/ 3) {
    			// update activeOption when activeIndex changes
    			$$invalidate(47, activeOption = activeIndex ? matchingOptions[activeIndex] : null);
    		}

    		if ($$self.$$.dirty[0] & /*selectedLabels*/ 32) {
    			$$invalidate(38, is_selected = label => selectedLabels.includes(label));
    		}
    	};

    	return [
    		activeIndex,
    		matchingOptions,
    		options,
    		searchText,
    		selected,
    		selectedLabels,
    		input,
    		invalid,
    		open,
    		outerDiv,
    		addOptionMsg,
    		allowUserOptions,
    		autocomplete,
    		defaultDisabledTitle,
    		disabledInputTitle,
    		id,
    		inputClass,
    		liActiveOptionClass,
    		liOptionClass,
    		liSelectedClass,
    		loading,
    		maxSelect,
    		maxSelectMsg,
    		name,
    		noOptionsMsg,
    		outerDivClass,
    		parseLabelsAsHtml,
    		placeholder,
    		removeAllTitle,
    		removeBtnTitle,
    		required,
    		ulOptionsClass,
    		ulSelectedClass,
    		disabled,
    		formValue,
    		add_option_msg_is_active,
    		window_width,
    		wiggle,
    		is_selected,
    		add,
    		remove,
    		open_dropdown,
    		handle_keydown,
    		remove_all,
    		if_enter_or_space,
    		on_click_outside,
    		selectedValues,
    		activeOption,
    		autoScroll,
    		breakpoint,
    		filterFunc,
    		focusInputOnSelect,
    		sortSelected,
    		slots,
    		mousedown_handler,
    		mousedown_handler_1,
    		onwindowresize,
    		input0_input_handler,
    		invalid_handler,
    		mouseup_handler,
    		keydown_handler,
    		input1_binding,
    		input1_input_handler,
    		wiggle_1_wiggle_binding,
    		mouseup_handler_1,
    		mouseover_handler,
    		focus_handler,
    		mouseout_handler,
    		blur_handler,
    		mouseup_handler_2,
    		mouseover_handler_1,
    		focus_handler_1,
    		mouseout_handler_1,
    		blur_handler_1,
    		div_binding,
    		$$scope
    	];
    }

    class MultiSelect extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(
    			this,
    			options,
    			instance$7,
    			create_fragment$c,
    			safe_not_equal,
    			{
    				activeIndex: 0,
    				activeOption: 47,
    				addOptionMsg: 10,
    				allowUserOptions: 11,
    				autocomplete: 12,
    				autoScroll: 48,
    				breakpoint: 49,
    				defaultDisabledTitle: 13,
    				disabled: 33,
    				disabledInputTitle: 14,
    				filterFunc: 50,
    				focusInputOnSelect: 51,
    				id: 15,
    				input: 6,
    				inputClass: 16,
    				invalid: 7,
    				liActiveOptionClass: 17,
    				liOptionClass: 18,
    				liSelectedClass: 19,
    				loading: 20,
    				matchingOptions: 1,
    				maxSelect: 21,
    				maxSelectMsg: 22,
    				name: 23,
    				noOptionsMsg: 24,
    				open: 8,
    				options: 2,
    				outerDiv: 9,
    				outerDivClass: 25,
    				parseLabelsAsHtml: 26,
    				placeholder: 27,
    				removeAllTitle: 28,
    				removeBtnTitle: 29,
    				required: 30,
    				searchText: 3,
    				selected: 4,
    				selectedLabels: 5,
    				selectedValues: 46,
    				sortSelected: 52,
    				ulOptionsClass: 31,
    				ulSelectedClass: 32
    			},
    			null,
    			[-1, -1, -1]
    		);
    	}
    }

    // get the label key from an option object or the option itself if it's a string or number
    const get_label = (op) => (op instanceof Object ? op.label : op);
    // fallback on label if option is object and value is undefined
    const get_value = (op) => op instanceof Object ? op.value ?? op.label : op;
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

    /* src\components\EditUser.svelte generated by Svelte v3.50.1 */

    function create_default_slot_2$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Update");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Update");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (148:6) <Button on:click={revert} type="submit" mode="danger">
    function create_default_slot_1$4(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Revert");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Revert");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (113:0) <Modal title="Edit User" on:close>
    function create_default_slot$6(ctx) {
    	let form;
    	let div2;
    	let div0;
    	let strong0;
    	let t0;
    	let t1;
    	let t2;
    	let div1;
    	let label0;
    	let strong1;
    	let t3;
    	let t4;
    	let input;
    	let t5;
    	let textinput0;
    	let t6;
    	let textinput1;
    	let t7;
    	let label1;
    	let strong2;
    	let t8;
    	let t9;
    	let multiselect;
    	let updating_selected;
    	let t10;
    	let div3;
    	let button0;
    	let t11;
    	let button1;
    	let current;
    	let mounted;
    	let dispose;

    	textinput0 = new TextInput({
    			props: {
    				id: "password",
    				label: "New password",
    				type: "password",
    				placeholder: "Enter a password"
    			}
    		});

    	textinput0.$on("input", /*input_handler*/ ctx[10]);

    	textinput1 = new TextInput({
    			props: {
    				id: "password",
    				label: "Email",
    				type: "email",
    				placeholder: "Enter email",
    				value: /*email*/ ctx[2]
    			}
    		});

    	textinput1.$on("input", /*input_handler_1*/ ctx[11]);

    	function multiselect_selected_binding(value) {
    		/*multiselect_selected_binding*/ ctx[12](value);
    	}

    	let multiselect_props = {
    		options: /*grouplist*/ ctx[0],
    		id: "groups"
    	};

    	if (/*selected*/ ctx[4] !== void 0) {
    		multiselect_props.selected = /*selected*/ ctx[4];
    	}

    	multiselect = new MultiSelect({ props: multiselect_props });
    	binding_callbacks.push(() => bind(multiselect, 'selected', multiselect_selected_binding));

    	button0 = new Button({
    			props: {
    				type: "submit",
    				$$slots: { default: [create_default_slot_2$1] },
    				$$scope: { ctx }
    			}
    		});

    	button1 = new Button({
    			props: {
    				type: "submit",
    				mode: "danger",
    				$$slots: { default: [create_default_slot_1$4] },
    				$$scope: { ctx }
    			}
    		});

    	button1.$on("click", /*revert*/ ctx[7]);

    	return {
    		c() {
    			form = element("form");
    			div2 = element("div");
    			div0 = element("div");
    			strong0 = element("strong");
    			t0 = text("Username: ");
    			t1 = text(/*username*/ ctx[5]);
    			t2 = space();
    			div1 = element("div");
    			label0 = element("label");
    			strong1 = element("strong");
    			t3 = text("Access Status");
    			t4 = space();
    			input = element("input");
    			t5 = space();
    			create_component(textinput0.$$.fragment);
    			t6 = space();
    			create_component(textinput1.$$.fragment);
    			t7 = space();
    			label1 = element("label");
    			strong2 = element("strong");
    			t8 = text("Groups");
    			t9 = space();
    			create_component(multiselect.$$.fragment);
    			t10 = space();
    			div3 = element("div");
    			create_component(button0.$$.fragment);
    			t11 = space();
    			create_component(button1.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			form = claim_element(nodes, "FORM", { class: true });
    			var form_nodes = children(form);
    			div2 = claim_element(form_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			div0 = claim_element(div2_nodes, "DIV", {});
    			var div0_nodes = children(div0);
    			strong0 = claim_element(div0_nodes, "STRONG", {});
    			var strong0_nodes = children(strong0);
    			t0 = claim_text(strong0_nodes, "Username: ");
    			strong0_nodes.forEach(detach);
    			t1 = claim_text(div0_nodes, /*username*/ ctx[5]);
    			div0_nodes.forEach(detach);
    			t2 = claim_space(div2_nodes);
    			div1 = claim_element(div2_nodes, "DIV", {});
    			var div1_nodes = children(div1);
    			label0 = claim_element(div1_nodes, "LABEL", { for: true });
    			var label0_nodes = children(label0);
    			strong1 = claim_element(label0_nodes, "STRONG", {});
    			var strong1_nodes = children(strong1);
    			t3 = claim_text(strong1_nodes, "Access Status");
    			strong1_nodes.forEach(detach);
    			label0_nodes.forEach(detach);
    			t4 = claim_space(div1_nodes);
    			input = claim_element(div1_nodes, "INPUT", { type: true, name: true, id: true });
    			div1_nodes.forEach(detach);
    			div2_nodes.forEach(detach);
    			t5 = claim_space(form_nodes);
    			claim_component(textinput0.$$.fragment, form_nodes);
    			t6 = claim_space(form_nodes);
    			claim_component(textinput1.$$.fragment, form_nodes);
    			t7 = claim_space(form_nodes);
    			label1 = claim_element(form_nodes, "LABEL", { for: true });
    			var label1_nodes = children(label1);
    			strong2 = claim_element(label1_nodes, "STRONG", {});
    			var strong2_nodes = children(strong2);
    			t8 = claim_text(strong2_nodes, "Groups");
    			strong2_nodes.forEach(detach);
    			label1_nodes.forEach(detach);
    			t9 = claim_space(form_nodes);
    			claim_component(multiselect.$$.fragment, form_nodes);
    			t10 = claim_space(form_nodes);
    			div3 = claim_element(form_nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);
    			claim_component(button0.$$.fragment, div3_nodes);
    			t11 = claim_space(div3_nodes);
    			claim_component(button1.$$.fragment, div3_nodes);
    			div3_nodes.forEach(detach);
    			form_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(label0, "for", "checkbox");
    			attr(input, "type", "checkbox");
    			attr(input, "name", "checkbox");
    			attr(input, "id", "checkbox");
    			attr(div2, "class", "name-status svelte-mve55o");
    			attr(label1, "for", "groups");
    			attr(div3, "class", "footer-btn svelte-mve55o");
    			attr(form, "class", "svelte-mve55o");
    		},
    		m(target, anchor) {
    			insert_hydration(target, form, anchor);
    			append_hydration(form, div2);
    			append_hydration(div2, div0);
    			append_hydration(div0, strong0);
    			append_hydration(strong0, t0);
    			append_hydration(div0, t1);
    			append_hydration(div2, t2);
    			append_hydration(div2, div1);
    			append_hydration(div1, label0);
    			append_hydration(label0, strong1);
    			append_hydration(strong1, t3);
    			append_hydration(div1, t4);
    			append_hydration(div1, input);
    			input.checked = /*status*/ ctx[3];
    			append_hydration(form, t5);
    			mount_component(textinput0, form, null);
    			append_hydration(form, t6);
    			mount_component(textinput1, form, null);
    			append_hydration(form, t7);
    			append_hydration(form, label1);
    			append_hydration(label1, strong2);
    			append_hydration(strong2, t8);
    			append_hydration(form, t9);
    			mount_component(multiselect, form, null);
    			append_hydration(form, t10);
    			append_hydration(form, div3);
    			mount_component(button0, div3, null);
    			append_hydration(div3, t11);
    			mount_component(button1, div3, null);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(input, "change", /*input_change_handler*/ ctx[9]),
    					listen(form, "submit", prevent_default(/*updateUser*/ ctx[6]))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*status*/ 8) {
    				input.checked = /*status*/ ctx[3];
    			}

    			const textinput1_changes = {};
    			if (dirty & /*email*/ 4) textinput1_changes.value = /*email*/ ctx[2];
    			textinput1.$set(textinput1_changes);
    			const multiselect_changes = {};
    			if (dirty & /*grouplist*/ 1) multiselect_changes.options = /*grouplist*/ ctx[0];

    			if (!updating_selected && dirty & /*selected*/ 16) {
    				updating_selected = true;
    				multiselect_changes.selected = /*selected*/ ctx[4];
    				add_flush_callback(() => updating_selected = false);
    			}

    			multiselect.$set(multiselect_changes);
    			const button0_changes = {};

    			if (dirty & /*$$scope*/ 524288) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 524288) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(multiselect.$$.fragment, local);
    			transition_in(button0.$$.fragment, local);
    			transition_in(button1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(multiselect.$$.fragment, local);
    			transition_out(button0.$$.fragment, local);
    			transition_out(button1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(form);
    			destroy_component(textinput0);
    			destroy_component(textinput1);
    			destroy_component(multiselect);
    			destroy_component(button0);
    			destroy_component(button1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment$b(ctx) {
    	let modal;
    	let current;

    	modal = new Modal({
    			props: {
    				title: "Edit User",
    				$$slots: { default: [create_default_slot$6] },
    				$$scope: { ctx }
    			}
    		});

    	modal.$on("close", /*close_handler*/ ctx[13]);

    	return {
    		c() {
    			create_component(modal.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(modal.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(modal, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const modal_changes = {};

    			if (dirty & /*$$scope, grouplist, selected, email, newPassword, status*/ 524319) {
    				modal_changes.$$scope = { dirty, ctx };
    			}

    			modal.$set(modal_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(modal.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(modal.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(modal, detaching);
    		}
    	};
    }

    function instance$6($$self, $$props, $$invalidate) {
    	createEventDispatcher();
    	let { userlist } = $$props;
    	let { grouplist } = $$props;
    	let newPassword = "";
    	let username = userlist.username;
    	let password = userlist.password;
    	let email = userlist.email;
    	let status = userlist.status;
    	let belongsTo = userlist.belongsTo;
    	let selected = [];
    	const pwRegex = new RegExp(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,10}$/);
    	const emailRegex = new RegExp(/^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)$/);

    	onMount(() => {
    		if (belongsTo.length) {
    			$$invalidate(4, selected = belongsTo.split(","));
    		}
    	});

    	async function updateUser() {
    		console.log(newPassword);

    		if (emailRegex.test(email) || email === "") {
    			if (newPassword === "") {
    				const url = "http://localhost:8080/updatealluserinfoep";

    				fetch(url, {
    					method: "POST",
    					body: JSON.stringify({
    						username,
    						email,
    						status,
    						belongsTo: selected.join(","),
    						editor: sessionStorage.getItem("JWT")
    					})
    				}).then(response => response.json()).then(data => {
    					alert(data.Message);
    					console.log(data);
    				}).catch(error => {
    					console.log(error);
    				});
    			} else {
    				if (!pwRegex.test(newPassword)) {
    					alert("Password does not meet requirement");
    				} else {
    					const url = "http://localhost:8080/updatealluserinfo";

    					fetch(url, {
    						method: "POST",
    						body: JSON.stringify({
    							username,
    							password: newPassword,
    							email,
    							status,
    							belongsTo: selected.join(","),
    							editor: sessionStorage.getItem("JWT")
    						})
    					}).then(response => response.json()).then(data => {
    						alert(data.Message);
    						console.log(data);
    					}).catch(error => {
    						console.log(error);
    					});
    				}
    			}
    		} else {
    			alert("Email does not meet requirement");
    		}
    	}

    	function revert() {
    		alert("Information reset to when it first open");
    		$$invalidate(1, newPassword = "");
    		belongsTo = userlist.belongsTo;

    		if (belongsTo.length) {
    			$$invalidate(4, selected = belongsTo.split(","));
    		}

    		$$invalidate(2, email = userlist.email);
    		password = userlist.password;
    		$$invalidate(3, status = userlist.status);
    		const url = "http://localhost:8080/revertuserpassword";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				username,
    				password,
    				editor: sessionStorage.getItem("JWT")
    			})
    		}).then(response => response.json()).then(_ => {
    			
    		}).catch(error => {
    			console.log(error);
    		});
    	}

    	function input_change_handler() {
    		status = this.checked;
    		$$invalidate(3, status);
    	}

    	const input_handler = e => $$invalidate(1, newPassword = e.target.value);
    	const input_handler_1 = e => $$invalidate(2, email = e.target.value);

    	function multiselect_selected_binding(value) {
    		selected = value;
    		$$invalidate(4, selected);
    	}

    	function close_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('userlist' in $$props) $$invalidate(8, userlist = $$props.userlist);
    		if ('grouplist' in $$props) $$invalidate(0, grouplist = $$props.grouplist);
    	};

    	return [
    		grouplist,
    		newPassword,
    		email,
    		status,
    		selected,
    		username,
    		updateUser,
    		revert,
    		userlist,
    		input_change_handler,
    		input_handler,
    		input_handler_1,
    		multiselect_selected_binding,
    		close_handler
    	];
    }

    class EditUser extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$6, create_fragment$b, safe_not_equal, { userlist: 8, grouplist: 0 });
    	}
    }

    /* src\components\CreateUser.svelte generated by Svelte v3.50.1 */

    function create_default_slot_1$3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Create");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Create");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (134:6) <Button mode="outline" on:click={handleClose}>
    function create_default_slot$5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Close");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Close");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$a(ctx) {
    	let main;
    	let form;
    	let textinput0;
    	let t0;
    	let textinput1;
    	let t1;
    	let textinput2;
    	let t2;
    	let div0;
    	let button0;
    	let t3;
    	let div1;
    	let button1;
    	let current;
    	let mounted;
    	let dispose;

    	textinput0 = new TextInput({
    			props: {
    				id: "username",
    				label: "Username",
    				value: /*username*/ ctx[0],
    				placeholder: "Enter a username"
    			}
    		});

    	textinput0.$on("input", /*handleUsernameChange*/ ctx[3]);

    	textinput1 = new TextInput({
    			props: {
    				id: "password",
    				label: "Password",
    				type: "password",
    				value: /*password*/ ctx[1],
    				placeholder: "Enter a password"
    			}
    		});

    	textinput1.$on("input", /*handlePasswordChange*/ ctx[4]);

    	textinput2 = new TextInput({
    			props: {
    				id: "email",
    				label: "Email",
    				type: "email",
    				value: /*email*/ ctx[2],
    				placeholder: "Enter a email"
    			}
    		});

    	textinput2.$on("input", /*handleEmailChange*/ ctx[5]);

    	button0 = new Button({
    			props: {
    				mode: "outline",
    				type: "submit",
    				$$slots: { default: [create_default_slot_1$3] },
    				$$scope: { ctx }
    			}
    		});

    	button1 = new Button({
    			props: {
    				mode: "outline",
    				$$slots: { default: [create_default_slot$5] },
    				$$scope: { ctx }
    			}
    		});

    	button1.$on("click", /*handleClose*/ ctx[7]);

    	return {
    		c() {
    			main = element("main");
    			form = element("form");
    			create_component(textinput0.$$.fragment);
    			t0 = space();
    			create_component(textinput1.$$.fragment);
    			t1 = space();
    			create_component(textinput2.$$.fragment);
    			t2 = space();
    			div0 = element("div");
    			create_component(button0.$$.fragment);
    			t3 = space();
    			div1 = element("div");
    			create_component(button1.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			form = claim_element(main_nodes, "FORM", { class: true });
    			var form_nodes = children(form);
    			claim_component(textinput0.$$.fragment, form_nodes);
    			t0 = claim_space(form_nodes);
    			claim_component(textinput1.$$.fragment, form_nodes);
    			t1 = claim_space(form_nodes);
    			claim_component(textinput2.$$.fragment, form_nodes);
    			t2 = claim_space(form_nodes);
    			div0 = claim_element(form_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			claim_component(button0.$$.fragment, div0_nodes);
    			div0_nodes.forEach(detach);
    			t3 = claim_space(form_nodes);
    			div1 = claim_element(form_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			claim_component(button1.$$.fragment, div1_nodes);
    			div1_nodes.forEach(detach);
    			form_nodes.forEach(detach);
    			main_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div0, "class", "svelte-1f51a8p");
    			attr(div1, "class", "svelte-1f51a8p");
    			attr(form, "class", "iCreate svelte-1f51a8p");
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			append_hydration(main, form);
    			mount_component(textinput0, form, null);
    			append_hydration(form, t0);
    			mount_component(textinput1, form, null);
    			append_hydration(form, t1);
    			mount_component(textinput2, form, null);
    			append_hydration(form, t2);
    			append_hydration(form, div0);
    			mount_component(button0, div0, null);
    			append_hydration(form, t3);
    			append_hydration(form, div1);
    			mount_component(button1, div1, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(form, "submit", prevent_default(/*handleSubmitCreateUser*/ ctx[6]));
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			const textinput0_changes = {};
    			if (dirty & /*username*/ 1) textinput0_changes.value = /*username*/ ctx[0];
    			textinput0.$set(textinput0_changes);
    			const textinput1_changes = {};
    			if (dirty & /*password*/ 2) textinput1_changes.value = /*password*/ ctx[1];
    			textinput1.$set(textinput1_changes);
    			const textinput2_changes = {};
    			if (dirty & /*email*/ 4) textinput2_changes.value = /*email*/ ctx[2];
    			textinput2.$set(textinput2_changes);
    			const button0_changes = {};

    			if (dirty & /*$$scope*/ 524288) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 524288) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(textinput2.$$.fragment, local);
    			transition_in(button0.$$.fragment, local);
    			transition_in(button1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(textinput2.$$.fragment, local);
    			transition_out(button0.$$.fragment, local);
    			transition_out(button1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(textinput0);
    			destroy_component(textinput1);
    			destroy_component(textinput2);
    			destroy_component(button0);
    			destroy_component(button1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let { users } = $$props;
    	let userlist = users.map(user => user.username);
    	const dispatch = createEventDispatcher();
    	let username = "";
    	let password = "";
    	let email = "";
    	let creator = sessionStorage.getItem("JWT");
    	let usernameBlank = true;
    	let usernameError = true;
    	let passwordError = true;
    	let emailError = false;
    	const pwRegex = new RegExp(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,10}$/);
    	const emailRegex = new RegExp(/^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)$/);

    	const emptyFields = () => {
    		$$invalidate(0, username = "");
    		$$invalidate(1, password = "");
    		$$invalidate(2, email = "");
    	};

    	const handleUsernameChange = e => {
    		$$invalidate(0, username = e.target.value);

    		if (e.target.value == "") {
    			usernameBlank = true;
    		} else {
    			usernameBlank = false;

    			if (userlist.includes(e.target.value.trim())) {
    				usernameError = true;
    			} else {
    				usernameError = false;
    			}
    		}
    	};

    	const handlePasswordChange = e => {
    		$$invalidate(1, password = e.target.value);

    		if (pwRegex.test(e.target.value)) {
    			passwordError = false;
    		} else {
    			passwordError = true;
    		}
    	};

    	const handleEmailChange = e => {
    		$$invalidate(2, email = e.target.value);

    		if (emailRegex.test(e.target.value)) {
    			emailError = false;
    		} else {
    			if (email == "") {
    				emailError = false;
    			} else {
    				emailError = true;
    			}
    		}
    	};

    	const handleSubmitCreateUser = () => {
    		if (usernameBlank) {
    			alert("Username cant be empty");
    		} else if (usernameError) {
    			alert("Username in use");
    		} else if (passwordError) {
    			alert("Invalid Password");
    		} else if (emailError) {
    			alert("Invalid Email");
    		} else {
    			const url = "http://localhost:8080/createUser";

    			fetch(url, {
    				method: "POST",
    				body: JSON.stringify({
    					editor: creator,
    					username,
    					password,
    					email
    				})
    			}).then(response => response.json()).then(data => {
    				if (data.Code == 200) {
    					emptyFields();
    					alert("User created!");
    					dispatch("submit");
    				}
    			}).catch(error => {
    				console.log(error);
    			});
    		}
    	};

    	const handleClose = () => {
    		dispatch("close");
    	};

    	$$self.$$set = $$props => {
    		if ('users' in $$props) $$invalidate(8, users = $$props.users);
    	};

    	return [
    		username,
    		password,
    		email,
    		handleUsernameChange,
    		handlePasswordChange,
    		handleEmailChange,
    		handleSubmitCreateUser,
    		handleClose,
    		users
    	];
    }

    class CreateUser extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$5, create_fragment$a, safe_not_equal, { users: 8 });
    	}
    }

    /* src\components\AllUser.svelte generated by Svelte v3.50.1 */

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[12] = list[i];
    	child_ctx[14] = i;
    	return child_ctx;
    }

    // (87:2) {:else}
    function create_else_block_1(ctx) {
    	let div;
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				$$slots: { default: [create_default_slot_1$2] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*showCreate*/ ctx[8]);

    	return {
    		c() {
    			div = element("div");
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			claim_component(button.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "createDiv svelte-4a2wcm");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			mount_component(button, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(button);
    		}
    	};
    }

    // (85:2) {#if createBar}
    function create_if_block_2(ctx) {
    	let createuser;
    	let current;
    	createuser = new CreateUser({ props: { users: /*userlist*/ ctx[2] } });
    	createuser.$on("close", /*closeCreate*/ ctx[9]);
    	createuser.$on("submit", /*submit_handler*/ ctx[10]);

    	return {
    		c() {
    			create_component(createuser.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(createuser.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(createuser, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const createuser_changes = {};
    			if (dirty & /*userlist*/ 4) createuser_changes.users = /*userlist*/ ctx[2];
    			createuser.$set(createuser_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(createuser.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(createuser.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(createuser, detaching);
    		}
    	};
    }

    // (89:6) <Button on:click={showCreate}>
    function create_default_slot_1$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Create User");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Create User");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (109:10) {:else}
    function create_else_block$1(ctx) {
    	let td;
    	let t_value = /*user*/ ctx[12].status + "";
    	let t;

    	return {
    		c() {
    			td = element("td");
    			t = text(t_value);
    			this.h();
    		},
    		l(nodes) {
    			td = claim_element(nodes, "TD", { class: true });
    			var td_nodes = children(td);
    			t = claim_text(td_nodes, t_value);
    			td_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(td, "class", "notAllow svelte-4a2wcm");
    		},
    		m(target, anchor) {
    			insert_hydration(target, td, anchor);
    			append_hydration(td, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*userlist*/ 4 && t_value !== (t_value = /*user*/ ctx[12].status + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(td);
    		}
    	};
    }

    // (107:10) {#if user.status}
    function create_if_block_1(ctx) {
    	let td;
    	let t_value = /*user*/ ctx[12].status + "";
    	let t;

    	return {
    		c() {
    			td = element("td");
    			t = text(t_value);
    			this.h();
    		},
    		l(nodes) {
    			td = claim_element(nodes, "TD", { class: true });
    			var td_nodes = children(td);
    			t = claim_text(td_nodes, t_value);
    			td_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(td, "class", "allow svelte-4a2wcm");
    		},
    		m(target, anchor) {
    			insert_hydration(target, td, anchor);
    			append_hydration(td, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*userlist*/ 4 && t_value !== (t_value = /*user*/ ctx[12].status + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(td);
    		}
    	};
    }

    // (114:13) <Button size="sm" mode="outline" on:click={edituser(user.username)}                >
    function create_default_slot$4(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Edit");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Edit");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (102:4) {#each userlist as user, i}
    function create_each_block$1(ctx) {
    	let tbody;
    	let tr;
    	let td0;
    	let t0_value = /*user*/ ctx[12].username + "";
    	let t0;
    	let t1;
    	let td1;
    	let t2_value = /*user*/ ctx[12].email + "";
    	let t2;
    	let t3;
    	let t4;
    	let td2;
    	let t5_value = /*user*/ ctx[12].belongsTo + "";
    	let t5;
    	let t6;
    	let td3;
    	let button;
    	let t7;
    	let current;

    	function select_block_type_1(ctx, dirty) {
    		if (/*user*/ ctx[12].status) return create_if_block_1;
    		return create_else_block$1;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	button = new Button({
    			props: {
    				size: "sm",
    				mode: "outline",
    				$$slots: { default: [create_default_slot$4] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", function () {
    		if (is_function(/*edituser*/ ctx[6](/*user*/ ctx[12].username))) /*edituser*/ ctx[6](/*user*/ ctx[12].username).apply(this, arguments);
    	});

    	return {
    		c() {
    			tbody = element("tbody");
    			tr = element("tr");
    			td0 = element("td");
    			t0 = text(t0_value);
    			t1 = space();
    			td1 = element("td");
    			t2 = text(t2_value);
    			t3 = space();
    			if_block.c();
    			t4 = space();
    			td2 = element("td");
    			t5 = text(t5_value);
    			t6 = space();
    			td3 = element("td");
    			create_component(button.$$.fragment);
    			t7 = space();
    			this.h();
    		},
    		l(nodes) {
    			tbody = claim_element(nodes, "TBODY", {});
    			var tbody_nodes = children(tbody);
    			tr = claim_element(tbody_nodes, "TR", { class: true });
    			var tr_nodes = children(tr);
    			td0 = claim_element(tr_nodes, "TD", { class: true });
    			var td0_nodes = children(td0);
    			t0 = claim_text(td0_nodes, t0_value);
    			td0_nodes.forEach(detach);
    			t1 = claim_space(tr_nodes);
    			td1 = claim_element(tr_nodes, "TD", { class: true });
    			var td1_nodes = children(td1);
    			t2 = claim_text(td1_nodes, t2_value);
    			td1_nodes.forEach(detach);
    			t3 = claim_space(tr_nodes);
    			if_block.l(tr_nodes);
    			t4 = claim_space(tr_nodes);
    			td2 = claim_element(tr_nodes, "TD", { class: true });
    			var td2_nodes = children(td2);
    			t5 = claim_text(td2_nodes, t5_value);
    			td2_nodes.forEach(detach);
    			t6 = claim_space(tr_nodes);
    			td3 = claim_element(tr_nodes, "TD", { class: true });
    			var td3_nodes = children(td3);
    			claim_component(button.$$.fragment, td3_nodes);
    			td3_nodes.forEach(detach);
    			tr_nodes.forEach(detach);
    			t7 = claim_space(tbody_nodes);
    			tbody_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(td0, "class", "svelte-4a2wcm");
    			attr(td1, "class", "svelte-4a2wcm");
    			attr(td2, "class", "svelte-4a2wcm");
    			attr(td3, "class", "svelte-4a2wcm");
    			attr(tr, "class", "" + (null_to_empty(/*i*/ ctx[14] % 2 === 0 && "alt-row") + " svelte-4a2wcm"));
    		},
    		m(target, anchor) {
    			insert_hydration(target, tbody, anchor);
    			append_hydration(tbody, tr);
    			append_hydration(tr, td0);
    			append_hydration(td0, t0);
    			append_hydration(tr, t1);
    			append_hydration(tr, td1);
    			append_hydration(td1, t2);
    			append_hydration(tr, t3);
    			if_block.m(tr, null);
    			append_hydration(tr, t4);
    			append_hydration(tr, td2);
    			append_hydration(td2, t5);
    			append_hydration(tr, t6);
    			append_hydration(tr, td3);
    			mount_component(button, td3, null);
    			append_hydration(tbody, t7);
    			current = true;
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if ((!current || dirty & /*userlist*/ 4) && t0_value !== (t0_value = /*user*/ ctx[12].username + "")) set_data(t0, t0_value);
    			if ((!current || dirty & /*userlist*/ 4) && t2_value !== (t2_value = /*user*/ ctx[12].email + "")) set_data(t2, t2_value);

    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(tr, t4);
    				}
    			}

    			if ((!current || dirty & /*userlist*/ 4) && t5_value !== (t5_value = /*user*/ ctx[12].belongsTo + "")) set_data(t5, t5_value);
    			const button_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(tbody);
    			if_block.d();
    			destroy_component(button);
    		}
    	};
    }

    // (123:2) {#if editForm}
    function create_if_block$1(ctx) {
    	let edituser_1;
    	let current;

    	edituser_1 = new EditUser({
    			props: {
    				userlist: /*currentUser*/ ctx[4],
    				grouplist: /*grouplist*/ ctx[3]
    			}
    		});

    	edituser_1.$on("close", /*closeEditUser*/ ctx[7]);

    	return {
    		c() {
    			create_component(edituser_1.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(edituser_1.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(edituser_1, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const edituser_1_changes = {};
    			if (dirty & /*currentUser*/ 16) edituser_1_changes.userlist = /*currentUser*/ ctx[4];
    			if (dirty & /*grouplist*/ 8) edituser_1_changes.grouplist = /*grouplist*/ ctx[3];
    			edituser_1.$set(edituser_1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(edituser_1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(edituser_1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(edituser_1, detaching);
    		}
    	};
    }

    function create_fragment$9(ctx) {
    	let div;
    	let current_block_type_index;
    	let if_block0;
    	let t0;
    	let table;
    	let thead;
    	let tr;
    	let th0;
    	let t1;
    	let t2;
    	let th1;
    	let t3;
    	let t4;
    	let th2;
    	let t5;
    	let t6;
    	let th3;
    	let t7;
    	let t8;
    	let th4;
    	let t9;
    	let t10;
    	let t11;
    	let current;
    	const if_block_creators = [create_if_block_2, create_else_block_1];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*createBar*/ ctx[0]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	let each_value = /*userlist*/ ctx[2];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	let if_block1 = /*editForm*/ ctx[1] && create_if_block$1(ctx);

    	return {
    		c() {
    			div = element("div");
    			if_block0.c();
    			t0 = space();
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			th0 = element("th");
    			t1 = text("Name");
    			t2 = space();
    			th1 = element("th");
    			t3 = text("Email");
    			t4 = space();
    			th2 = element("th");
    			t5 = text("Status");
    			t6 = space();
    			th3 = element("th");
    			t7 = text("Groups");
    			t8 = space();
    			th4 = element("th");
    			t9 = text("Edit");
    			t10 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t11 = space();
    			if (if_block1) if_block1.c();
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			if_block0.l(div_nodes);
    			t0 = claim_space(div_nodes);
    			table = claim_element(div_nodes, "TABLE", { class: true });
    			var table_nodes = children(table);
    			thead = claim_element(table_nodes, "THEAD", {});
    			var thead_nodes = children(thead);
    			tr = claim_element(thead_nodes, "TR", { class: true });
    			var tr_nodes = children(tr);
    			th0 = claim_element(tr_nodes, "TH", { class: true });
    			var th0_nodes = children(th0);
    			t1 = claim_text(th0_nodes, "Name");
    			th0_nodes.forEach(detach);
    			t2 = claim_space(tr_nodes);
    			th1 = claim_element(tr_nodes, "TH", { class: true });
    			var th1_nodes = children(th1);
    			t3 = claim_text(th1_nodes, "Email");
    			th1_nodes.forEach(detach);
    			t4 = claim_space(tr_nodes);
    			th2 = claim_element(tr_nodes, "TH", { class: true });
    			var th2_nodes = children(th2);
    			t5 = claim_text(th2_nodes, "Status");
    			th2_nodes.forEach(detach);
    			t6 = claim_space(tr_nodes);
    			th3 = claim_element(tr_nodes, "TH", { class: true });
    			var th3_nodes = children(th3);
    			t7 = claim_text(th3_nodes, "Groups");
    			th3_nodes.forEach(detach);
    			t8 = claim_space(tr_nodes);
    			th4 = claim_element(tr_nodes, "TH", { class: true });
    			var th4_nodes = children(th4);
    			t9 = claim_text(th4_nodes, "Edit");
    			th4_nodes.forEach(detach);
    			tr_nodes.forEach(detach);
    			thead_nodes.forEach(detach);
    			t10 = claim_space(table_nodes);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(table_nodes);
    			}

    			table_nodes.forEach(detach);
    			t11 = claim_space(div_nodes);
    			if (if_block1) if_block1.l(div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(th0, "class", "svelte-4a2wcm");
    			attr(th1, "class", "svelte-4a2wcm");
    			attr(th2, "class", "svelte-4a2wcm");
    			attr(th3, "class", "svelte-4a2wcm");
    			attr(th4, "class", "svelte-4a2wcm");
    			attr(tr, "class", "svelte-4a2wcm");
    			attr(table, "class", "svelte-4a2wcm");
    			attr(div, "class", "page-container");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			if_blocks[current_block_type_index].m(div, null);
    			append_hydration(div, t0);
    			append_hydration(div, table);
    			append_hydration(table, thead);
    			append_hydration(thead, tr);
    			append_hydration(tr, th0);
    			append_hydration(th0, t1);
    			append_hydration(tr, t2);
    			append_hydration(tr, th1);
    			append_hydration(th1, t3);
    			append_hydration(tr, t4);
    			append_hydration(tr, th2);
    			append_hydration(th2, t5);
    			append_hydration(tr, t6);
    			append_hydration(tr, th3);
    			append_hydration(th3, t7);
    			append_hydration(tr, t8);
    			append_hydration(tr, th4);
    			append_hydration(th4, t9);
    			append_hydration(table, t10);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(table, null);
    			}

    			append_hydration(div, t11);
    			if (if_block1) if_block1.m(div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block0 = if_blocks[current_block_type_index];

    				if (!if_block0) {
    					if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block0.c();
    				} else {
    					if_block0.p(ctx, dirty);
    				}

    				transition_in(if_block0, 1);
    				if_block0.m(div, t0);
    			}

    			if (dirty & /*edituser, userlist*/ 68) {
    				each_value = /*userlist*/ ctx[2];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(table, null);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}

    			if (/*editForm*/ ctx[1]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);

    					if (dirty & /*editForm*/ 2) {
    						transition_in(if_block1, 1);
    					}
    				} else {
    					if_block1 = create_if_block$1(ctx);
    					if_block1.c();
    					transition_in(if_block1, 1);
    					if_block1.m(div, null);
    				}
    			} else if (if_block1) {
    				group_outros();

    				transition_out(if_block1, 1, 1, () => {
    					if_block1 = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block0);

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			transition_in(if_block1);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block0);
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			transition_out(if_block1);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if_blocks[current_block_type_index].d();
    			destroy_each(each_blocks, detaching);
    			if (if_block1) if_block1.d();
    		}
    	};
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let createBar = false;
    	let editForm = false;
    	let userlist = [];
    	let grouplist = [];
    	let currentUser;

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
    			$$invalidate(2, userlist = data);

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
    			const dataArr = data.map(grp => grp.groupname);
    			$$invalidate(3, grouplist = dataArr);
    		}).catch(error => {
    			console.log(error);
    		});
    	}

    	function edituser(username) {
    		const url = "http://localhost:8080/fetchuser";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({
    				username,
    				editor: sessionStorage.getItem("JWT")
    			})
    		}).then(response => response.json()).then(data => {
    			$$invalidate(4, currentUser = data);
    			$$invalidate(1, editForm = true);
    		}).catch(error => {
    			console.log(error);
    		});
    	}

    	function closeEditUser() {
    		getAllUser();
    		$$invalidate(1, editForm = false);
    	}

    	const showCreate = () => {
    		$$invalidate(0, createBar = true);
    	};

    	const closeCreate = () => {
    		getAllUser();
    		$$invalidate(0, createBar = false);
    	};

    	const submit_handler = () => getAllUser();

    	return [
    		createBar,
    		editForm,
    		userlist,
    		grouplist,
    		currentUser,
    		getAllUser,
    		edituser,
    		closeEditUser,
    		showCreate,
    		closeCreate,
    		submit_handler
    	];
    }

    class AllUser extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$4, create_fragment$9, safe_not_equal, {});
    	}
    }

    /* src\page\UserManagement.svelte generated by Svelte v3.50.1 */

    function create_fragment$8(ctx) {
    	let main;
    	let navbar;
    	let t;
    	let alluser;
    	let current;
    	navbar = new Navbar({});
    	alluser = new AllUser({});

    	return {
    		c() {
    			main = element("main");
    			create_component(navbar.$$.fragment);
    			t = space();
    			create_component(alluser.$$.fragment);
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			claim_component(navbar.$$.fragment, main_nodes);
    			t = claim_space(main_nodes);
    			claim_component(alluser.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			mount_component(navbar, main, null);
    			append_hydration(main, t);
    			mount_component(alluser, main, null);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(alluser.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(alluser.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(navbar);
    			destroy_component(alluser);
    		}
    	};
    }

    class UserManagement extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$8, safe_not_equal, {});
    	}
    }

    /* src\components\ProfileContent.svelte generated by Svelte v3.50.1 */

    function create_default_slot_1$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Submit");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Submit");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (112:8) <Button on:click={handlePasswordSubmission}>
    function create_default_slot$3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Submit");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Submit");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$7(ctx) {
    	let main;
    	let div2;
    	let h20;
    	let t0;
    	let t1;
    	let div1;
    	let textinput0;
    	let t2;
    	let div0;
    	let button0;
    	let t3;
    	let div5;
    	let h21;
    	let t4;
    	let t5;
    	let div4;
    	let textinput1;
    	let t6;
    	let div3;
    	let button1;
    	let current;

    	textinput0 = new TextInput({
    			props: {
    				id: "email",
    				type: "email",
    				label: "New Email",
    				placeholder: "Enter new email",
    				value: /*email*/ ctx[1]
    			}
    		});

    	textinput0.$on("input", /*input_handler*/ ctx[4]);

    	button0 = new Button({
    			props: {
    				$$slots: { default: [create_default_slot_1$1] },
    				$$scope: { ctx }
    			}
    		});

    	button0.$on("click", /*handleEmailSubmission*/ ctx[3]);

    	textinput1 = new TextInput({
    			props: {
    				id: "password",
    				type: "password",
    				label: "New Password",
    				placeholder: "Enter new password",
    				value: /*password*/ ctx[0]
    			}
    		});

    	textinput1.$on("input", /*input_handler_1*/ ctx[5]);

    	button1 = new Button({
    			props: {
    				$$slots: { default: [create_default_slot$3] },
    				$$scope: { ctx }
    			}
    		});

    	button1.$on("click", /*handlePasswordSubmission*/ ctx[2]);

    	return {
    		c() {
    			main = element("main");
    			div2 = element("div");
    			h20 = element("h2");
    			t0 = text("Edit Email");
    			t1 = space();
    			div1 = element("div");
    			create_component(textinput0.$$.fragment);
    			t2 = space();
    			div0 = element("div");
    			create_component(button0.$$.fragment);
    			t3 = space();
    			div5 = element("div");
    			h21 = element("h2");
    			t4 = text("Edit Password");
    			t5 = space();
    			div4 = element("div");
    			create_component(textinput1.$$.fragment);
    			t6 = space();
    			div3 = element("div");
    			create_component(button1.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", { class: true });
    			var main_nodes = children(main);
    			div2 = claim_element(main_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			h20 = claim_element(div2_nodes, "H2", { class: true });
    			var h20_nodes = children(h20);
    			t0 = claim_text(h20_nodes, "Edit Email");
    			h20_nodes.forEach(detach);
    			t1 = claim_space(div2_nodes);
    			div1 = claim_element(div2_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			claim_component(textinput0.$$.fragment, div1_nodes);
    			t2 = claim_space(div1_nodes);
    			div0 = claim_element(div1_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			claim_component(button0.$$.fragment, div0_nodes);
    			div0_nodes.forEach(detach);
    			div1_nodes.forEach(detach);
    			div2_nodes.forEach(detach);
    			t3 = claim_space(main_nodes);
    			div5 = claim_element(main_nodes, "DIV", { class: true });
    			var div5_nodes = children(div5);
    			h21 = claim_element(div5_nodes, "H2", { class: true });
    			var h21_nodes = children(h21);
    			t4 = claim_text(h21_nodes, "Edit Password");
    			h21_nodes.forEach(detach);
    			t5 = claim_space(div5_nodes);
    			div4 = claim_element(div5_nodes, "DIV", { class: true });
    			var div4_nodes = children(div4);
    			claim_component(textinput1.$$.fragment, div4_nodes);
    			t6 = claim_space(div4_nodes);
    			div3 = claim_element(div4_nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);
    			claim_component(button1.$$.fragment, div3_nodes);
    			div3_nodes.forEach(detach);
    			div4_nodes.forEach(detach);
    			div5_nodes.forEach(detach);
    			main_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(h20, "class", "svelte-129bvhm");
    			attr(div0, "class", "submit-btn svelte-129bvhm");
    			attr(div1, "class", "input-wrapper svelte-129bvhm");
    			attr(div2, "class", "section svelte-129bvhm");
    			attr(h21, "class", "svelte-129bvhm");
    			attr(div3, "class", "submit-btn svelte-129bvhm");
    			attr(div4, "class", "input-wrapper svelte-129bvhm");
    			attr(div5, "class", "section svelte-129bvhm");
    			attr(main, "class", "page-container svelte-129bvhm");
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			append_hydration(main, div2);
    			append_hydration(div2, h20);
    			append_hydration(h20, t0);
    			append_hydration(div2, t1);
    			append_hydration(div2, div1);
    			mount_component(textinput0, div1, null);
    			append_hydration(div1, t2);
    			append_hydration(div1, div0);
    			mount_component(button0, div0, null);
    			append_hydration(main, t3);
    			append_hydration(main, div5);
    			append_hydration(div5, h21);
    			append_hydration(h21, t4);
    			append_hydration(div5, t5);
    			append_hydration(div5, div4);
    			mount_component(textinput1, div4, null);
    			append_hydration(div4, t6);
    			append_hydration(div4, div3);
    			mount_component(button1, div3, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const textinput0_changes = {};
    			if (dirty & /*email*/ 2) textinput0_changes.value = /*email*/ ctx[1];
    			textinput0.$set(textinput0_changes);
    			const button0_changes = {};

    			if (dirty & /*$$scope*/ 256) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const textinput1_changes = {};
    			if (dirty & /*password*/ 1) textinput1_changes.value = /*password*/ ctx[0];
    			textinput1.$set(textinput1_changes);
    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 256) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput0.$$.fragment, local);
    			transition_in(button0.$$.fragment, local);
    			transition_in(textinput1.$$.fragment, local);
    			transition_in(button1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput0.$$.fragment, local);
    			transition_out(button0.$$.fragment, local);
    			transition_out(textinput1.$$.fragment, local);
    			transition_out(button1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(textinput0);
    			destroy_component(button0);
    			destroy_component(textinput1);
    			destroy_component(button1);
    		}
    	};
    }

    function validatePassword(password) {
    	var passwordRegEx = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,10}/;
    	return passwordRegEx.test(String(password).toLowerCase());
    }

    function validateEmail(email) {
    	var emailRegEx = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    	return emailRegEx.test(String(email).toLowerCase());
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let password = "";
    	let email = "";
    	let passworderrormsg = "";
    	let emailerrormsg = "";

    	function handlePasswordSubmission() {
    		let isValidPassword = validatePassword(password);

    		if (isValidPassword) {
    			passworderrormsg = "";
    			const url = "http://localhost:8080/updateuserpassword";

    			fetch(url, {
    				method: "POST",
    				body: JSON.stringify({
    					token: sessionStorage.getItem("JWT"),
    					password
    				})
    			}).then(response => response.json()).then(data => {
    				alert(data.Message);
    				console.log(data);
    			}).catch(error => {
    				console.log(error);
    			});
    		} else {
    			passworderrormsg = "Invalid password";
    			alert(passworderrormsg);
    		}
    	}

    	function handleEmailSubmission() {
    		let isValidEmail = validateEmail(email);

    		if (isValidEmail) {
    			emailerrormsg = "";
    			const url = "http://localhost:8080/updateuseremail";

    			fetch(url, {
    				method: "POST",
    				body: JSON.stringify({
    					token: sessionStorage.getItem("JWT"),
    					email
    				})
    			}).then(response => response.json()).then(data => {
    				alert(data.Message);
    				console.log(data);
    			}).catch(error => {
    				console.log(error);
    			});
    		} else {
    			emailerrormsg = "Invalid email";
    			alert(emailerrormsg);
    		}
    	}

    	const input_handler = e => $$invalidate(1, email = e.target.value);
    	const input_handler_1 = e => $$invalidate(0, password = e.target.value);

    	return [
    		password,
    		email,
    		handlePasswordSubmission,
    		handleEmailSubmission,
    		input_handler,
    		input_handler_1
    	];
    }

    class ProfileContent extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$3, create_fragment$7, safe_not_equal, {});
    	}
    }

    /* src\page\Profile.svelte generated by Svelte v3.50.1 */

    function create_fragment$6(ctx) {
    	let navbar;
    	let t;
    	let profilecontent;
    	let current;
    	navbar = new Navbar({});
    	profilecontent = new ProfileContent({});

    	return {
    		c() {
    			create_component(navbar.$$.fragment);
    			t = space();
    			create_component(profilecontent.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(navbar.$$.fragment, nodes);
    			t = claim_space(nodes);
    			claim_component(profilecontent.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(navbar, target, anchor);
    			insert_hydration(target, t, anchor);
    			mount_component(profilecontent, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(profilecontent.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(profilecontent.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(navbar, detaching);
    			if (detaching) detach(t);
    			destroy_component(profilecontent, detaching);
    		}
    	};
    }

    class Profile extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$6, safe_not_equal, {});
    	}
    }

    // if the value is notempty
    function isEmpty(val) {
      return val.trim().length === 0
    }

    /* src\components\AllGroups.svelte generated by Svelte v3.50.1 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[8] = list[i];
    	child_ctx[10] = i;
    	return child_ctx;
    }

    // (81:4) {:else}
    function create_else_block(ctx) {
    	let div;
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				$$slots: { default: [create_default_slot_2] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*toggleEditForm*/ ctx[4]);

    	return {
    		c() {
    			div = element("div");
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			claim_component(button.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "class", "createDiv svelte-19y6orm");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			mount_component(button, div, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const button_changes = {};

    			if (dirty & /*$$scope*/ 2048) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(button);
    		}
    	};
    }

    // (63:4) {#if editForm}
    function create_if_block(ctx) {
    	let form;
    	let textinput;
    	let t0;
    	let div2;
    	let div0;
    	let button0;
    	let t1;
    	let div1;
    	let button1;
    	let current;
    	let mounted;
    	let dispose;

    	textinput = new TextInput({
    			props: {
    				id: "groupname",
    				label: "Group name",
    				placeholder: "Enter group name",
    				value: /*groupname*/ ctx[0]
    			}
    		});

    	textinput.$on("input", /*input_handler*/ ctx[5]);

    	button0 = new Button({
    			props: {
    				type: "submit",
    				mode: "outline",
    				$$slots: { default: [create_default_slot_1] },
    				$$scope: { ctx }
    			}
    		});

    	button1 = new Button({
    			props: {
    				mode: "outline",
    				$$slots: { default: [create_default_slot$2] },
    				$$scope: { ctx }
    			}
    		});

    	button1.$on("click", /*toggleEditForm*/ ctx[4]);

    	return {
    		c() {
    			form = element("form");
    			create_component(textinput.$$.fragment);
    			t0 = space();
    			div2 = element("div");
    			div0 = element("div");
    			create_component(button0.$$.fragment);
    			t1 = space();
    			div1 = element("div");
    			create_component(button1.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			form = claim_element(nodes, "FORM", { class: true });
    			var form_nodes = children(form);
    			claim_component(textinput.$$.fragment, form_nodes);
    			t0 = claim_space(form_nodes);
    			div2 = claim_element(form_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			div0 = claim_element(div2_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			claim_component(button0.$$.fragment, div0_nodes);
    			div0_nodes.forEach(detach);
    			t1 = claim_space(div2_nodes);
    			div1 = claim_element(div2_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			claim_component(button1.$$.fragment, div1_nodes);
    			div1_nodes.forEach(detach);
    			div2_nodes.forEach(detach);
    			form_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div0, "class", "svelte-19y6orm");
    			attr(div1, "class", "svelte-19y6orm");
    			attr(div2, "class", "create-group-btn svelte-19y6orm");
    			attr(form, "class", "add-group svelte-19y6orm");
    		},
    		m(target, anchor) {
    			insert_hydration(target, form, anchor);
    			mount_component(textinput, form, null);
    			append_hydration(form, t0);
    			append_hydration(form, div2);
    			append_hydration(div2, div0);
    			mount_component(button0, div0, null);
    			append_hydration(div2, t1);
    			append_hydration(div2, div1);
    			mount_component(button1, div1, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(form, "submit", prevent_default(/*createGroup*/ ctx[3]));
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			const textinput_changes = {};
    			if (dirty & /*groupname*/ 1) textinput_changes.value = /*groupname*/ ctx[0];
    			textinput.$set(textinput_changes);
    			const button0_changes = {};

    			if (dirty & /*$$scope*/ 2048) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 2048) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(textinput.$$.fragment, local);
    			transition_in(button0.$$.fragment, local);
    			transition_in(button1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(textinput.$$.fragment, local);
    			transition_out(button0.$$.fragment, local);
    			transition_out(button1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(form);
    			destroy_component(textinput);
    			destroy_component(button0);
    			destroy_component(button1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (83:8) <Button on:click={toggleEditForm}>
    function create_default_slot_2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Create Group");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Create Group");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (74:12) <Button type="submit" mode="outline">
    function create_default_slot_1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Add Group");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Add Group");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (77:12) <Button on:click={toggleEditForm} mode="outline">
    function create_default_slot$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Close");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Close");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (95:8) {#each grouplist as group, i}
    function create_each_block(ctx) {
    	let tr;
    	let td0;
    	let t0_value = /*i*/ ctx[10] + 1 + "";
    	let t0;
    	let t1;
    	let td1;
    	let t2_value = /*group*/ ctx[8] + "";
    	let t2;
    	let t3;

    	return {
    		c() {
    			tr = element("tr");
    			td0 = element("td");
    			t0 = text(t0_value);
    			t1 = space();
    			td1 = element("td");
    			t2 = text(t2_value);
    			t3 = space();
    			this.h();
    		},
    		l(nodes) {
    			tr = claim_element(nodes, "TR", { class: true });
    			var tr_nodes = children(tr);
    			td0 = claim_element(tr_nodes, "TD", { class: true });
    			var td0_nodes = children(td0);
    			t0 = claim_text(td0_nodes, t0_value);
    			td0_nodes.forEach(detach);
    			t1 = claim_space(tr_nodes);
    			td1 = claim_element(tr_nodes, "TD", { class: true });
    			var td1_nodes = children(td1);
    			t2 = claim_text(td1_nodes, t2_value);
    			td1_nodes.forEach(detach);
    			t3 = claim_space(tr_nodes);
    			tr_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(td0, "class", "svelte-19y6orm");
    			attr(td1, "class", "svelte-19y6orm");
    			attr(tr, "class", "" + (null_to_empty(/*i*/ ctx[10] % 2 === 0 && "alt-row") + " svelte-19y6orm"));
    		},
    		m(target, anchor) {
    			insert_hydration(target, tr, anchor);
    			append_hydration(tr, td0);
    			append_hydration(td0, t0);
    			append_hydration(tr, t1);
    			append_hydration(tr, td1);
    			append_hydration(td1, t2);
    			append_hydration(tr, t3);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*grouplist*/ 2 && t2_value !== (t2_value = /*group*/ ctx[8] + "")) set_data(t2, t2_value);
    		},
    		d(detaching) {
    			if (detaching) detach(tr);
    		}
    	};
    }

    function create_fragment$5(ctx) {
    	let main;
    	let div;
    	let current_block_type_index;
    	let if_block;
    	let t0;
    	let table;
    	let thead;
    	let tr;
    	let th0;
    	let t1;
    	let t2;
    	let th1;
    	let t3;
    	let t4;
    	let tbody;
    	let current;
    	const if_block_creators = [create_if_block, create_else_block];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*editForm*/ ctx[2]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    	let each_value = /*grouplist*/ ctx[1];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			main = element("main");
    			div = element("div");
    			if_block.c();
    			t0 = space();
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			th0 = element("th");
    			t1 = text("S/N");
    			t2 = space();
    			th1 = element("th");
    			t3 = text("Name");
    			t4 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.h();
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			div = claim_element(main_nodes, "DIV", { class: true });
    			var div_nodes = children(div);
    			if_block.l(div_nodes);
    			t0 = claim_space(div_nodes);
    			table = claim_element(div_nodes, "TABLE", { class: true });
    			var table_nodes = children(table);
    			thead = claim_element(table_nodes, "THEAD", {});
    			var thead_nodes = children(thead);
    			tr = claim_element(thead_nodes, "TR", { class: true });
    			var tr_nodes = children(tr);
    			th0 = claim_element(tr_nodes, "TH", { class: true });
    			var th0_nodes = children(th0);
    			t1 = claim_text(th0_nodes, "S/N");
    			th0_nodes.forEach(detach);
    			t2 = claim_space(tr_nodes);
    			th1 = claim_element(tr_nodes, "TH", { class: true });
    			var th1_nodes = children(th1);
    			t3 = claim_text(th1_nodes, "Name");
    			th1_nodes.forEach(detach);
    			tr_nodes.forEach(detach);
    			thead_nodes.forEach(detach);
    			t4 = claim_space(table_nodes);
    			tbody = claim_element(table_nodes, "TBODY", {});
    			var tbody_nodes = children(tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].l(tbody_nodes);
    			}

    			tbody_nodes.forEach(detach);
    			table_nodes.forEach(detach);
    			div_nodes.forEach(detach);
    			main_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(th0, "class", "svelte-19y6orm");
    			attr(th1, "class", "svelte-19y6orm");
    			attr(tr, "class", "svelte-19y6orm");
    			attr(table, "class", "svelte-19y6orm");
    			attr(div, "class", "page-container svelte-19y6orm");
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			append_hydration(main, div);
    			if_blocks[current_block_type_index].m(div, null);
    			append_hydration(div, t0);
    			append_hydration(div, table);
    			append_hydration(table, thead);
    			append_hydration(thead, tr);
    			append_hydration(tr, th0);
    			append_hydration(th0, t1);
    			append_hydration(tr, t2);
    			append_hydration(tr, th1);
    			append_hydration(th1, t3);
    			append_hydration(table, t4);
    			append_hydration(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}

    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(div, t0);
    			}

    			if (dirty & /*grouplist*/ 2) {
    				each_value = /*grouplist*/ ctx[1];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			if_blocks[current_block_type_index].d();
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let grouplist = [];
    	let groupname = "";
    	let editForm = false;

    	onMount(() => {
    		getAllGroups();
    	});

    	async function getAllGroups() {
    		const url = "http://localhost:8080/fetchgroups";

    		fetch(url).then(response => response.json()).then(data => {
    			const dataArr = data.map(grp => grp.groupname);
    			$$invalidate(1, grouplist = dataArr);
    		}).catch(error => {
    			console.log(error);
    		});
    	}

    	const createGroup = e => {
    		e.preventDefault();

    		if (!groupname.length) {
    			alert("Group name cannot be empty.");
    			return;
    		}

    		const url = "http://localhost:8080/creategroup";

    		fetch(url, {
    			method: "POST",
    			body: JSON.stringify({ groupname })
    		}).then(response => response.json()).then(data => {
    			alert(data[0].Message);
    			$$invalidate(0, groupname = "");
    			getAllGroups();
    		}).catch(error => {
    			console.log(error);
    		});
    	};

    	const toggleEditForm = () => {
    		$$invalidate(2, editForm = !editForm);
    	};

    	const input_handler = e => $$invalidate(0, groupname = e.target.value);

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*groupname*/ 1) {
    			!isEmpty(groupname);
    		}
    	};

    	return [groupname, grouplist, editForm, createGroup, toggleEditForm, input_handler];
    }

    class AllGroups extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$5, safe_not_equal, {});
    	}
    }

    /* src\page\GroupManagement.svelte generated by Svelte v3.50.1 */

    function create_fragment$4(ctx) {
    	let main;
    	let navbar;
    	let t;
    	let allgroups;
    	let current;
    	navbar = new Navbar({});
    	allgroups = new AllGroups({});

    	return {
    		c() {
    			main = element("main");
    			create_component(navbar.$$.fragment);
    			t = space();
    			create_component(allgroups.$$.fragment);
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			claim_component(navbar.$$.fragment, main_nodes);
    			t = claim_space(main_nodes);
    			claim_component(allgroups.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			mount_component(navbar, main, null);
    			append_hydration(main, t);
    			mount_component(allgroups, main, null);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(allgroups.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(allgroups.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(navbar);
    			destroy_component(allgroups);
    		}
    	};
    }

    class GroupManagement extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$4, safe_not_equal, {});
    	}
    }

    /* src\page\NotFound.svelte generated by Svelte v3.50.1 */

    function create_default_slot$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Return Home");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "Return Home");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$3(ctx) {
    	let main;
    	let h2;
    	let t0;
    	let t1;
    	let button;
    	let current;

    	button = new Button({
    			props: {
    				$$slots: { default: [create_default_slot$1] },
    				$$scope: { ctx }
    			}
    		});

    	button.$on("click", /*click_handler*/ ctx[0]);

    	return {
    		c() {
    			main = element("main");
    			h2 = element("h2");
    			t0 = text("Page not found");
    			t1 = space();
    			create_component(button.$$.fragment);
    			this.h();
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", { class: true });
    			var main_nodes = children(main);
    			h2 = claim_element(main_nodes, "H2", {});
    			var h2_nodes = children(h2);
    			t0 = claim_text(h2_nodes, "Page not found");
    			h2_nodes.forEach(detach);
    			t1 = claim_space(main_nodes);
    			claim_component(button.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(main, "class", "page-container");
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			append_hydration(main, h2);
    			append_hydration(h2, t0);
    			append_hydration(main, t1);
    			mount_component(button, main, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const button_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				button_changes.$$scope = { dirty, ctx };
    			}

    			button.$set(button_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(button);
    		}
    	};
    }

    function instance$1($$self) {
    	const click_handler = () => navigate("/dashboard");
    	return [click_handler];
    }

    class NotFound extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$3, safe_not_equal, {});
    	}
    }

    /* src\page\AppForm.svelte generated by Svelte v3.50.1 */

    function create_fragment$2(ctx) {
    	let main;
    	let navbar;
    	let t;
    	let appform;
    	let current;
    	navbar = new Navbar({});
    	appform = new AppForm({});

    	return {
    		c() {
    			main = element("main");
    			create_component(navbar.$$.fragment);
    			t = space();
    			create_component(appform.$$.fragment);
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			claim_component(navbar.$$.fragment, main_nodes);
    			t = claim_space(main_nodes);
    			claim_component(appform.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			mount_component(navbar, main, null);
    			append_hydration(main, t);
    			mount_component(appform, main, null);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(appform.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(appform.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(navbar);
    			destroy_component(appform);
    		}
    	};
    }

    class AppForm_1 extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$2, safe_not_equal, {});
    	}
    }

    /* src\page\TaskForma.svelte generated by Svelte v3.50.1 */

    function create_fragment$1(ctx) {
    	let main;
    	let navbar;
    	let t;
    	let taskform;
    	let current;
    	navbar = new Navbar({});
    	taskform = new TaskForma$1({});

    	return {
    		c() {
    			main = element("main");
    			create_component(navbar.$$.fragment);
    			t = space();
    			create_component(taskform.$$.fragment);
    		},
    		l(nodes) {
    			main = claim_element(nodes, "MAIN", {});
    			var main_nodes = children(main);
    			claim_component(navbar.$$.fragment, main_nodes);
    			t = claim_space(main_nodes);
    			claim_component(taskform.$$.fragment, main_nodes);
    			main_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, main, anchor);
    			mount_component(navbar, main, null);
    			append_hydration(main, t);
    			mount_component(taskform, main, null);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(navbar.$$.fragment, local);
    			transition_in(taskform.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(navbar.$$.fragment, local);
    			transition_out(taskform.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(navbar);
    			destroy_component(taskform);
    		}
    	};
    }

    class TaskForma extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$1, safe_not_equal, {});
    	}
    }

    /* src\App.svelte generated by Svelte v3.50.1 */

    function create_default_slot(ctx) {
    	let route0;
    	let t0;
    	let protectedroutes0;
    	let t1;
    	let protectedroutes1;
    	let t2;
    	let protectedroutes2;
    	let t3;
    	let protectedroutes3;
    	let t4;
    	let protectedroutes4;
    	let t5;
    	let protectedroutes5;
    	let t6;
    	let route1;
    	let current;

    	route0 = new Route({
    			props: { path: "/", component: Homepage }
    		});

    	protectedroutes0 = new ProtectedRoutes({
    			props: { path: "/dashboard", component: Dashboard }
    		});

    	protectedroutes1 = new ProtectedRoutes({
    			props: { path: "/appForm", component: AppForm_1 }
    		});

    	protectedroutes2 = new ProtectedRoutes({
    			props: { path: "/taskForm", component: TaskForma }
    		});

    	protectedroutes3 = new ProtectedRoutes({
    			props: { path: "/profile", component: Profile }
    		});

    	protectedroutes4 = new ProtectedRoutes({
    			props: {
    				path: "/userManagement",
    				component: UserManagement
    			}
    		});

    	protectedroutes5 = new ProtectedRoutes({
    			props: {
    				path: "/groupManagement",
    				component: GroupManagement
    			}
    		});

    	route1 = new Route({ props: { component: NotFound } });

    	return {
    		c() {
    			create_component(route0.$$.fragment);
    			t0 = space();
    			create_component(protectedroutes0.$$.fragment);
    			t1 = space();
    			create_component(protectedroutes1.$$.fragment);
    			t2 = space();
    			create_component(protectedroutes2.$$.fragment);
    			t3 = space();
    			create_component(protectedroutes3.$$.fragment);
    			t4 = space();
    			create_component(protectedroutes4.$$.fragment);
    			t5 = space();
    			create_component(protectedroutes5.$$.fragment);
    			t6 = space();
    			create_component(route1.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(route0.$$.fragment, nodes);
    			t0 = claim_space(nodes);
    			claim_component(protectedroutes0.$$.fragment, nodes);
    			t1 = claim_space(nodes);
    			claim_component(protectedroutes1.$$.fragment, nodes);
    			t2 = claim_space(nodes);
    			claim_component(protectedroutes2.$$.fragment, nodes);
    			t3 = claim_space(nodes);
    			claim_component(protectedroutes3.$$.fragment, nodes);
    			t4 = claim_space(nodes);
    			claim_component(protectedroutes4.$$.fragment, nodes);
    			t5 = claim_space(nodes);
    			claim_component(protectedroutes5.$$.fragment, nodes);
    			t6 = claim_space(nodes);
    			claim_component(route1.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(route0, target, anchor);
    			insert_hydration(target, t0, anchor);
    			mount_component(protectedroutes0, target, anchor);
    			insert_hydration(target, t1, anchor);
    			mount_component(protectedroutes1, target, anchor);
    			insert_hydration(target, t2, anchor);
    			mount_component(protectedroutes2, target, anchor);
    			insert_hydration(target, t3, anchor);
    			mount_component(protectedroutes3, target, anchor);
    			insert_hydration(target, t4, anchor);
    			mount_component(protectedroutes4, target, anchor);
    			insert_hydration(target, t5, anchor);
    			mount_component(protectedroutes5, target, anchor);
    			insert_hydration(target, t6, anchor);
    			mount_component(route1, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(route0.$$.fragment, local);
    			transition_in(protectedroutes0.$$.fragment, local);
    			transition_in(protectedroutes1.$$.fragment, local);
    			transition_in(protectedroutes2.$$.fragment, local);
    			transition_in(protectedroutes3.$$.fragment, local);
    			transition_in(protectedroutes4.$$.fragment, local);
    			transition_in(protectedroutes5.$$.fragment, local);
    			transition_in(route1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(route0.$$.fragment, local);
    			transition_out(protectedroutes0.$$.fragment, local);
    			transition_out(protectedroutes1.$$.fragment, local);
    			transition_out(protectedroutes2.$$.fragment, local);
    			transition_out(protectedroutes3.$$.fragment, local);
    			transition_out(protectedroutes4.$$.fragment, local);
    			transition_out(protectedroutes5.$$.fragment, local);
    			transition_out(route1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(route0, detaching);
    			if (detaching) detach(t0);
    			destroy_component(protectedroutes0, detaching);
    			if (detaching) detach(t1);
    			destroy_component(protectedroutes1, detaching);
    			if (detaching) detach(t2);
    			destroy_component(protectedroutes2, detaching);
    			if (detaching) detach(t3);
    			destroy_component(protectedroutes3, detaching);
    			if (detaching) detach(t4);
    			destroy_component(protectedroutes4, detaching);
    			if (detaching) detach(t5);
    			destroy_component(protectedroutes5, detaching);
    			if (detaching) detach(t6);
    			destroy_component(route1, detaching);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let router;
    	let current;

    	router = new Router({
    			props: {
    				url: /*url*/ ctx[0],
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(router.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(router.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(router, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const router_changes = {};
    			if (dirty & /*url*/ 1) router_changes.url = /*url*/ ctx[0];

    			if (dirty & /*$$scope*/ 2) {
    				router_changes.$$scope = { dirty, ctx };
    			}

    			router.$set(router_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(router.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(router.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(router, detaching);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { url = "" } = $$props;

    	$$self.$$set = $$props => {
    		if ('url' in $$props) $$invalidate(0, url = $$props.url);
    	};

    	return [url];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { url: 0 });
    	}
    }

    new App({
      target: document.getElementById("app"),
      hydrate: true,
    });

})();
//# sourceMappingURL=bundle.js.map
