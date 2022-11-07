<script>
  import { createEventDispatcher } from "svelte";
  import applicationMethods from "../store/application-store";
  import appcolorMethods from "../store/color-store";

  import Button from "../UI/Button.svelte";
  import Modal from "../UI/Modal.svelte"
  import TextInput from "../UI/TextInput.svelte";

  const dispatchEvent = createEventDispatcher();

  export let appselected;
  export let apps;

  let planname = "";
  let startdate = "";
  let enddate = "";
  //for plan need only permit open can create plan
  let group = $applicationMethods.filter(e => e.appname === appselected)[0]["permitOpen"]; 
  


  const handleClose = () => {
    dispatchEvent("close");
  }

  const emptyFields = () => {
    [ planname, startdate, enddate] = ["","",""];
  };

  const handleSubmitCreatePlan = () => {
    if (planname == "") {
      alert("Planname can't be empty");
    } else if (apps.includes(planname)) {
      alert("Plan name not allowed, please select a different plan name")
    } else if (startdate == "") {
      alert("Start date can't be empty");
    } else if (startdate > enddate) {
      alert("End date can't be empty");
    } else if (startdate > enddate) {
      alert("Start date cannot before before the End date");
    } else if (planname == "allplans") {
      alert("Please use another planname")
    }else {
      const url = "http://localhost:8080/createplan";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          acronym: appselected,
          planname: planname,
          startdate: startdate,
          enddate: enddate,
          editor: sessionStorage.getItem("JWT"),
          group: group
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          console.log(data)
          if (data.Code != 200) {
            alert(data.Message);  
          }else{
            alert("Successfully created plan")
            appcolorMethods.addPlanColors(planname)
            dispatchEvent("update")
          }
          emptyFields();
         
        })
        .catch((error) => {
          console.log(error);
        });
    }
  };

  // $: console.log(planname);
  // $: console.log(startdate);
  // $: console.log(enddate);
  // $: console.log(appselected);
</script>


<main>
<Modal title="Create Plan" on:close>
  <form on:submit|preventDefault={handleSubmitCreatePlan}>
    <!-- <div class="align-vertically">
      <TextInput 
      controlType="select"
      label="Application Name*"
      grouplist={appnames}
      on:input={((e) => appselected = e.target.value)}
      value={appselected}
      />
    </div> -->
    <TextInput
      id="appname"
      label="Application Name"
      value={appselected}
      type="Text"
      disable = true
    />

    <TextInput
      id="planname"
      label="New Plan Name*"
      value={planname}
      type="Text"
      placeholder="Please think of a plan name"
      on:input={(e) => {planname = e.target.value}}
    />

    <TextInput
      id="startdate"
      label="Start Date*"
      value={startdate}
      type="Date"
      on:input={(e) => {startdate = e.target.value}}
    />

    <TextInput
      id="enddate"
      label="End Date*"
      value={enddate}
      type="Date"
      on:input={(e) => {enddate = e.target.value}}
    />

    <div class="button-space">
      <Button mode="outline" on:click={handleClose}>Close</Button>
      <Button mode="outline" type="submit">Submit</Button>
    </div>
  </form>

  

</Modal>
</main>


<style>
.button-space{
  display: flex;
  justify-content: space-between;
}
/* .align-vertically{
  width: 40%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  margin: auto;
} */
</style>
