package routes

import (
	"myModule/src/controllers"
	subController "myModule/src/sub"

	"github.com/gorilla/mux"
)

func PlanRouter(r *mux.Router) {
	r.Handle("/createplan",subController.AuthAndConnect(controllers.CreatePlan)).Methods("POST")
	r.Handle("/getallplan",subController.AuthAndConnect(controllers.FetchPlans)).Methods("POST")
	r.Handle("/getplanbyapp",subController.AuthAndConnect(controllers.FetchPlansByApp)).Methods("POST")

}
