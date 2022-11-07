package models

import (
	"database/sql"
	"fmt"
	"myModule/src/entities"
)

type PLANDB struct {
	Db *sql.DB
}
//JunHe - check if app exist 
func (d *PLANDB) checkApp(acronym string) (bool){
	result, err := d.Db.Query("SELECT count(*) FROM application WHERE app_acronym =? ", acronym)
	if err != nil {
		return false
	}
	defer result.Close()
	var check int 
	for result.Next(){
		if err := result.Scan(&check); err != nil {
			fmt.Println(err)
		}
	}
	return (check >= 1)
}

//JunHe - create plan model
func (d *PLANDB) CreatePlan(planName string, sDate string, eDate string, acronym string) (bool, error){
	if d.checkApp(acronym){
		_, err := d.Db.Query("INSERT INTO plan (plan_mvp_name, plan_startDate, plan_endDate, plan_app_acronym) VALUES (?, ?, ?, ?);",planName, sDate, eDate, acronym)
		if err != nil {
			return false, err
		}
		return true, nil
	}
	return false, nil
}

//JunHe - Get All Plan model 
func (d *PLANDB) GetAllPlan() ([]entities.Plan, error){
	result, err := d.Db.Query("SELECT * FROM plan")
	if err != nil {
		return nil, err
	}
	defer result.Close()
	plans := []entities.Plan{}
	for result.Next() {
		var plan entities.Plan
		if err := result.Scan(&plan.PlanName, &plan.StartDate, &plan.EndDate, &plan.Acronym); err != nil {
			plans = append(plans, plan)
		}
		plans = append(plans, plan)
	}
	return plans, nil
}

//JunHe - Get Plan by acronym model
func (d *PLANDB) GetPlanByApp(acronym string) ([]entities.Plan, error){
	result, err := d.Db.Query("SELECT * FROM plan Where plan_app_acronym = ?", acronym)
	if err != nil {
		return nil, err
	}
	defer result.Close()
	plans := []entities.Plan{}
	for result.Next() {
		var plan entities.Plan
		if err := result.Scan(&plan.PlanName, &plan.StartDate, &plan.EndDate, &plan.Acronym); err != nil {
			plans = append(plans, plan)
		}
		plans = append(plans, plan)
	}
	return plans, nil
}