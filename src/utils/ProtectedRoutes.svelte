<script>
  import { onMount } from "svelte";
  import { navigate, Route } from "svelte-routing";
  import Homepage from "../page/Homepage.svelte";
  export let path;
  export let component;
  let isLoggedIn = false;
  let loaded = false;

  onMount(() => {
    let token = sessionStorage.getItem("JWT");
    if (token != undefined || token != null) {
      const url = "http://localhost:8080/authorize";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          token: token,
          group: "",
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.Code == 200) {
            isLoggedIn = true;
            loaded = true;
          } else {
            isLoggedIn = false;
            loaded = true;
            navigate("/");
          }
        })
        .catch((error) => {
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
</script>

{#if isLoggedIn && loaded}
  <Route {path} {component} />
{:else if !isLoggedIn && loaded}
  <Route component={Homepage} />
{/if}
