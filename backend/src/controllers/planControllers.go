package controllers

import (
	"database/sql"
	"encoding/json"
	"myModule/src/entities"
	"myModule/src/models"
	subController "myModule/src/sub"
	"net/http"
	"strings"
)

//Junhe - create plan controller
func CreatePlan(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	//db conneted
		planModel := models.PLANDB{
			Db: db,
		}
		//body readed
		plan := entities.Plan{}
		err := json.Unmarshal(body, &plan)
		if err != nil {
			subController.WriteJsonMsg(w,"Internal Server Error", false, 500)
			return
		}
		userModel := models.USERDB{
			Db: db,
		}
	if len(plan.Acronym) == 0 || len(plan.StartDate) == 0 || len(plan.EndDate) == 0 || len(plan.Group) == 0 || len(plan.PlanName) == 0 {
		subController.WriteJsonMsg(w,"Field cannot be empty", false, 406)
		return
	}else if (plan.PlanName == "allplans"){
		subController.WriteJsonMsg(w, "Please use another plan name", false, 406)
		return
	}else{
		if userModel.CheckGroup(username, plan.Group){
			res, err := planModel.CreatePlan(strings.TrimSpace(plan.PlanName), plan.StartDate, plan.EndDate, plan.Acronym)
				if err != nil {
					subController.WriteJsonMsg(w,"Plan Name exist", false, 407)
					return
				}else{
					if res {
						subController.WriteJsonMsg(w,"Plan created successfully", true, 200)
					} else{
						subController.WriteJsonMsg(w,"App name does not exist", false, 407)
					}
				}
			}else{
				subController.WriteJsonMsg(w,"User have no right to create new Plan", false, 408)
			}
		}
	}



//JunHe - get all plan controller 
func FetchPlans(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	
		planModel := models.PLANDB{
			Db: db,
		}

		plan := entities.Plan{}
		err := json.Unmarshal(body, &plan)
		if err != nil {
			subController.WriteJsonMsg(w,"Internal Server Error", false, 500)
			return
		}
		result, err := planModel.GetAllPlan()
		if err != nil {
			subController.WriteJsonMsg(w,"Internal Server Error", false, 500)
		} else {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}
	}


//JunHe - get all plan by acronym controller 
func FetchPlansByApp(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {

		planModel := models.PLANDB{
			Db: db,
		}

		plan := entities.Plan{}
		err := json.Unmarshal(body, &plan)
		if err != nil {
			subController.WriteJsonMsg(w,"Internal Server Error", false, 500)
			return
		}
		result, err := planModel.GetPlanByApp(plan.Acronym)
		if err != nil {
			subController.WriteJsonMsg(w,"Internal Server Error", false, 500)
		} else {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}
	}
