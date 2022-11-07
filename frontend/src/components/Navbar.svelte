<script>
import {navigate} from "svelte-routing"
import { onMount } from "svelte"

function logout(){
  sessionStorage.clear()
  navigate("/")
}

let isAdmin = "false"
onMount(()=>{
  let token = sessionStorage.getItem("JWT")
  if(token != undefined || token != null){
    const url = "http://localhost:8080/authorize"
      fetch(url,{
      method: "POST",
      body:JSON.stringify({
        token:token,
        group:"admin"
      })
    })
    .then(response => response.json())
    .then(data => {
      isAdmin = data.Message
    }).catch(error => {
      console.log(error);
    });
  }else{
    isAdmin = "false"
  }
  
}
)

</script>

<style>
.navbar {
  overflow: hidden;
  font-family: sans-serif;
  background-color: var(--main-color);
  border-bottom: 2px solid var(--border-light-color);
  max-width: 100vw;
  max-height: 10vh;
}

.navbar a {
  transition: 250ms;
  float: left;
  font-size: 16px;
  color: var(--font-light-color);
  text-align: center;
  padding: 14px 16px;
  text-decoration: none;
}

.dropdown {
  float: left;
  overflow: hidden;
}

.dropdown .dropbtn {
  transition:250ms;
  font-size: 16px;  
  border: none;
  outline: none;
  color: var(--font-light-color);
  padding: 14px 16px;
  background-color: inherit;
  font-family: inherit;
  margin: 0;
}

.navbar a:hover, .dropdown:hover .dropbtn {
  background-color: var(--main-light-color);
  cursor: pointer;
}
.navbar a:active{
  background-color: var(--main-dark-color);
}
.dropdown-content {
  border-radius: 2px;
  cursor: pointer;
  display: none;
  position: absolute;
  background-color: var(--background-light-color);
  min-width: 160px;
  box-shadow: 0px 4px 10px rgba(0,0,0,0.45);
  z-index: 1;
}

.dropdown:hover .dropdown-content {
  display: flex;
  flex-direction: column;
}
.topnav-right {
  float: right;
}
.dropItem{
  transition: 250ms;
  padding:5px 10px;
  font-family: sans-serif;
  outline: none;
  cursor: pointer;
  border: none;
  border-bottom: 1px solid var(--border-light-color);
  background-color: var(--main-color);
  color: var(--font-light-color);
}
.dropItem:hover{
  background-color: var(--main-light-color);
}
.dropItem:active{
  background-color: var(--main-dark-color); 
}
</style>

<nav class="navbar">
  <a href={null} on:click={()=>{navigate('/dashboard')}}>Dashboard</a>
  <a href={null} on:click={()=>{navigate('/profile')}}>Profile</a>
  {#if isAdmin === "true"}
  <div class="dropdown">
    <button class="dropbtn">Admin
      <i class="fa fa-caret-down"></i>
    </button>
    <div class="dropdown-content">
      <a href={null} class="dropItem" on:click={()=>{navigate('/userManagement')}}>User Management</a>
      <a href={null} class="dropItem" on:click={()=>{navigate('/groupManagement')}}>Group Management</a>
    </div>
  </div>
  {/if}
  <div class="topnav-right">
    <a href={null} on:click="{logout}" >Logout</a>
  </div>
</nav>