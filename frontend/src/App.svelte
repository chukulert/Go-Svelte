<script>
  import { Router } from "svelte-routing";
  import ProtectedRoutes from "./utils/ProtectedRoutes.svelte";
  import Dashboard from "./page/Dashboard.svelte";
  import UserManagement from "./page/UserManagement.svelte";
  import Profile from "./page/Profile.svelte";
  import GroupManagement from "./page/GroupManagement.svelte";
  import NotFound from "./page/NotFound.svelte";
  import AppForm from "./page/AppForm.svelte";
  import TaskForm from "./page/TaskForma.svelte";
  import { onMount } from "svelte"

  // Used for SSR. A falsy value is ignored by the Router.
  export let url = "";
  let isadmin = false; 
  let loaded = false;
  let nonadmin = true;

  onMount(() =>{
    let token = sessionStorage.getItem("JWT");
    if (token != undefined || token != null) {
      const url = "http://localhost:8080/authorize";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          token: token,
          group: "admin",
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.Success) {
            isadmin = data.Success;
            loaded = true;
          } else {
            nonadmin = !data.Success;
            loaded = true;
          }
        })
        .catch((error) => {
          loaded = true;
        });
    } else {
      loaded = true; 
    }
  });
</script>

<Router {url}>
  {#if loaded && (nonadmin || isadmin)}
  <ProtectedRoutes path="/dashboard" component={Dashboard} />
  <ProtectedRoutes path="/appForm" component={AppForm} />
  <ProtectedRoutes path="/taskForm" component={TaskForm} />
  <ProtectedRoutes path="/profile" component={Profile} />
  {:else if loaded}
  <ProtectedRoutes component={NotFound} />
  {/if}

  {#if isadmin && loaded}
  <ProtectedRoutes path="/userManagement" component={UserManagement}/>
  <ProtectedRoutes path="/groupManagement" component={GroupManagement}/>
  {:else if loaded}
  <ProtectedRoutes component={NotFound} />
  {/if}
</Router>
