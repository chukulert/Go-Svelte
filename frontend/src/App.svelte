<script>
  import { Router, Route } from "svelte-routing";
  import ProtectedRoutes from "./utils/ProtectedRoutes.svelte";
  import Dashboard from "./page/Dashboard.svelte";
  import Homepage from "./page/Homepage.svelte";
  import UserManagement from "./page/UserManagement.svelte";
  import Profile from "./page/Profile.svelte";
  import GroupManagement from "./page/GroupManagement.svelte";
  import NotFound from "./page/NotFound.svelte";
  import AppForm from "./page/AppForm.svelte";
  // import TaskForma from "./page/TaskForma.svelte";
    import TaskForm from "./page/TaskForma.svelte";
  // Used for SSR. A falsy value is ignored by the Router.
  export let url = "";
</script>

<Router {url}>
  <Route path="/" component={Homepage} />

  <ProtectedRoutes path="/dashboard" component={Dashboard} />
  <ProtectedRoutes path="/appForm" component={AppForm} />
  <ProtectedRoutes path="/taskForm" component={TaskForm} />
  <ProtectedRoutes path="/profile" component={Profile} />
  <ProtectedRoutes path="/userManagement" component={UserManagement}/>
  <ProtectedRoutes path="/groupManagement" component={GroupManagement}/>
  <Route component={NotFound} />
</Router>
