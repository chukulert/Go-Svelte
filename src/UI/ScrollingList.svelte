<script>
  import { createEventDispatcher} from "svelte";
  import appcolorMethods from "../store/color-store";

  export let arr;
  export let type;
  export let appselected;
  export let planselected;

  const dispatch = createEventDispatcher();

  const activateHighlight = (id, type) => {
    if (type === "application") {
      for (var i =0; i < arr.length; i++){
        document.getElementById(arr[i]).style.color = "black"
        document.getElementById(arr[i]).style.backgroundColor = "white"
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
      for (var i =0; i < arr.length; i++){
        document.getElementById(arr[i]).style.color = "black"
        document.getElementById(arr[i]).style.backgroundColor = "white"
      }
      document.getElementById(id).style.color = "red";
      document.getElementById(id).style.backgroundColor = "rgba(208, 208, 68, 0.232)";

      if (appselected === "allapps"){
        document.getElementById("allplans").style.color = "red";
        document.getElementById("allplans").style.backgroundColor = "rgba(208, 208, 68, 0.232)";
      }
      if (planselected !== "allplans") {
        document.getElementById("allplans").style.color = "black";
        document.getElementById("allplans").style.backgroundColor = "white";
      }
      if (id === "allplans"){
        document.getElementById("allplans").style.color = "red";
        document.getElementById("allplans").style.backgroundColor = "rgba(208, 208, 68, 0.232)";
      }
      
    }
    dispatch("selected",id);
      
  }

</script>

<div class="list">
  {#each arr as a (a)}
        <ul >
          <div class="list-item" >
            <li  class="legend-container" on:click={activateHighlight(a,type)} id={a}>
              {a}
              <span 
                class="legend" 
                style="background-color: {type == "application" ? $appcolorMethods.appColors[a] : type == "plan" ? $appcolorMethods.planColors[a] : ""}; {type == "plan" ? "border-radius: 25px;" : ""};">
              </span>
            </li>
          </div>
        </ul>
     
  {/each}
</div>

<style>
.list {
    font-weight: normal;
    overflow-y: auto;
    border: 1px solid #444;
    margin-top: 10px;
    
  }
.list-item {
  /* border: 1px 1px solid rgb(5, 5, 5); */
  cursor: pointer;
  color: black;
}
#allapps {
  /* background-color: rgb(255, 255, 255); */
  background-color: rgba(208, 208, 68, 0.232);
  color: red;
}
#allplans {
  background-color: rgba(208, 208, 68, 0.232);
  color: red;
}
.legend-container {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  margin: .2rem 0;
}
.legend{
  position: absolute;
  border-radius: 1px;
  box-shadow: 1px 1px 0px rgba(0,0,0,0.7);
  right: 10px;
  width: 15px;
  height: 15px;
}


</style>